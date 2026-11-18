import { activeAccessWhere } from "../access/access-state";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { addDays, type FeedTimezone, isFeedTimezone } from "../calendar-feed/ics-logic";
import type { AuthUser } from "../common/types/auth-user";
import type { CalendarConnection, OAuthAccount } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { rowToPayload } from "../records/record-mapper";
import { RECORD_TABLES } from "../records/record-schema";
import { RecordsService } from "../records/records.service";
import { LockService } from "../security/lock.service";
import {
  type AgendaFields,
  agendaFields,
  fieldsKey,
  fromGoogleEvent,
  fromGraphEvent,
  type GoogleEvent,
  type GraphEvent,
  inWindow,
  lockedFields,
  mergeIntoSchedule,
  shouldApplyRemote,
  SYNC_FUTURE_DAYS,
  SYNC_PAST_DAYS,
  toGoogleEvent,
  toGraphEvent,
} from "./calendar-sync-logic";
import { OAuthService } from "./oauth.service";
import type { OAuthProvider } from "./oauth-logic";

const TICK_MS = 60_000;
const SYNC_INTERVAL_MS = 5 * 60_000;
const MAX_PUSH = 300;
const CALENDAR_NAME = "Akasha";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

type Conn = CalendarConnection & { oauthAccount: OAuthAccount };
interface RemoteChange {
  id: string;
  removed: boolean;
  etag?: string;
  updated?: string;
  fields: AgendaFields | null;
}

/**
 * Kalender dua arah (docs/AKUN-TERSAMBUNG.md tahap 2): kalender khusus "Akasha" di Google Calendar / Outlook disinkron dengan agenda
 * Akasha. Agenda Akasha dikirim ke kalender itu; acara yang dibuat/diubah/dihapus di kalender itu (mis. dari HP) ikut ke Planner.
 * Bentrok = yang lebih baru menang. Kalender lain milik user tidak dibaca (scope Google `calendar.app.created`).
 */
@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly syncing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: OAuthService,
    private readonly records: RecordsService,
    private readonly locks: LockService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  view(c: CalendarConnection | null) {
    if (!c) return null;
    return {
      id: c.id,
      calendarName: c.calendarName,
      enabled: c.enabled,
      status: c.status,
      statusMessage: c.statusMessage,
      syncedAt: c.syncedAt,
    };
  }

  private async timezone(userId: string): Promise<FeedTimezone> {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { userId }, select: { timezone: true } });
    return feed && isFeedTimezone(feed.timezone) ? feed.timezone : "Asia/Jakarta";
  }

  private async conn(userId: string, oauthAccountId: string) {
    const conn = await this.prisma.calendarConnection.findFirst({
      where: { userId, oauthAccountId },
      include: { oauthAccount: true },
    });
    if (!conn) throw new NotFoundException("Kalender belum disambungkan.");
    return conn;
  }

  /** Sambungkan kalender: buat kalender "Akasha" di akun penyedia lalu sinkron pertama. */
  async connect(userId: string, oauthAccountId: string) {
    const account = await this.oauth.own(userId, oauthAccountId);
    if (await this.prisma.calendarConnection.findUnique({ where: { oauthAccountId } }))
      throw new ConflictException("Kalender akun ini sudah disambungkan.");
    const provider = account.provider as OAuthProvider;
    const api = this.oauth.endpoints(provider).api;
    const tz = await this.timezone(userId);
    const created =
      provider === "google"
        ? (
            await this.oauth.api<{ id: string }>(account, `${api}/calendars`, {
              method: "POST",
              body: { summary: CALENDAR_NAME, timeZone: tz },
            })
          ).data
        : (
            await this.oauth.api<{ id: string }>(account, `${api}/me/calendars`, {
              method: "POST",
              body: { name: CALENDAR_NAME },
            })
          ).data;
    const conn = await this.prisma.calendarConnection.create({
      data: { userId, oauthAccountId, calendarId: created.id, calendarName: CALENDAR_NAME },
      include: { oauthAccount: true },
    });
    await this.sync(conn).catch(() => undefined);
    return this.view(await this.prisma.calendarConnection.findUnique({ where: { id: conn.id } }));
  }

  async setEnabled(userId: string, oauthAccountId: string, enabled: boolean) {
    const conn = await this.conn(userId, oauthAccountId);
    return this.view(await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { enabled } }));
  }

  /** Putuskan: tautan dihapus; agenda Akasha & kalender "Akasha" di penyedia tetap ada. */
  async disconnect(userId: string, oauthAccountId: string) {
    const conn = await this.conn(userId, oauthAccountId);
    await this.prisma.calendarConnection.delete({ where: { id: conn.id } });
    return { ok: true };
  }

  async syncNow(userId: string, oauthAccountId: string) {
    return this.sync(await this.conn(userId, oauthAccountId));
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = new Date(Date.now() - SYNC_INTERVAL_MS);
      const conns = await this.prisma.calendarConnection.findMany({
        where: {
          enabled: true,
          oauthAccount: { status: "ok" },
          user: activeAccessWhere(),
          OR: [{ syncedAt: null }, { syncedAt: { lt: due } }],
        },
        include: { oauthAccount: true },
        take: 20,
      });
      for (const conn of conns) {
        await this.sync(conn).catch((error: unknown) =>
          this.logger.warn(
            `Sinkron kalender ${conn.oauthAccount.email} gagal: ${String((error as Error).message ?? error)}`,
          ),
        );
      }
    } catch (error) {
      this.logger.error(`Penjadwal kalender gagal: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------- Sinkron

  async sync(conn: Conn) {
    if (this.syncing.has(conn.id)) throw new ConflictException("Kalender ini sedang disinkron.");
    this.syncing.add(conn.id);
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: conn.userId },
        select: { id: true, email: true, role: true },
      });
      if (!user) throw new NotFoundException("Pengguna tidak ditemukan.");
      const auth: AuthUser = { id: user.id, email: user.email, role: user.role };
      const tz = await this.timezone(conn.userId);
      const pulled = await this.pull(conn, auth, tz);
      const pushed = await this.push(conn, tz);
      await this.prisma.calendarConnection.update({
        where: { id: conn.id },
        data: { status: "ok", statusMessage: null, syncedAt: new Date() },
      });
      return { ...pulled, ...pushed };
    } catch (error) {
      const message = String((error as Error).message ?? error).slice(0, 300);
      await this.prisma.calendarConnection
        .update({ where: { id: conn.id }, data: { status: "error", statusMessage: message, syncedAt: new Date() } })
        .catch(() => undefined);
      throw error instanceof BadRequestException ? error : new BadRequestException(message);
    } finally {
      this.syncing.delete(conn.id);
    }
  }

  private scheduleIdFor(connId: string, externalId: string) {
    return `cal-${hash(`${connId}:${externalId}`).slice(0, 20)}`;
  }

  private async scheduleRow(userId: string, clientId: string) {
    return this.prisma.schedule.findUnique({ where: { userId_clientId: { userId, clientId } } });
  }

  /** Tarik perubahan dari kalender luar → agenda Akasha. */
  private async pull(conn: Conn, user: AuthUser, tz: FeedTimezone) {
    const { changes, state } = await this.remoteChanges(conn, tz);
    let created = 0;
    let updated = 0;
    let removed = 0;
    const locked = (await this.locks.lockSet(conn.userId)).records;
    for (const change of changes) {
      const link = await this.prisma.calendarEventLink.findUnique({
        where: { connectionId_externalId: { connectionId: conn.id, externalId: change.id } },
      });
      if (change.removed) {
        if (!link) continue;
        const row = await this.scheduleRow(conn.userId, link.scheduleId);
        if (row && !row.deletedAt && !locked.has(`schedule:${link.scheduleId}`)) {
          await this.records.remove("schedule", link.scheduleId, {}, user).catch(() => undefined);
          removed++;
        }
        await this.prisma.calendarEventLink.delete({ where: { id: link.id } });
        continue;
      }
      if (!change.fields) continue;
      if (link) {
        if (link.etag && change.etag && link.etag === change.etag) continue;
        const row = await this.scheduleRow(conn.userId, link.scheduleId);
        if (!row || row.deletedAt || locked.has(`schedule:${link.scheduleId}`)) {
          await this.prisma.calendarEventLink.update({ where: { id: link.id }, data: { etag: change.etag ?? null } });
          continue;
        }
        const current = rowToPayload(RECORD_TABLES.schedule, row as never);
        const currentFields = agendaFields(current);
        const localChanged = !!currentFields && hash(fieldsKey(currentFields)) !== link.localHash;
        if (!shouldApplyRemote({ localChanged, localUpdatedAt: row.updatedAt, remoteUpdatedAt: change.updated }))
          continue;
        await this.records.upsert(
          "schedule",
          link.scheduleId,
          { payload: mergeIntoSchedule(current, change.fields, link.scheduleId) },
          user,
        );
        await this.prisma.calendarEventLink.update({
          where: { id: link.id },
          data: { etag: change.etag ?? null, localHash: hash(fieldsKey(change.fields)) },
        });
        updated++;
        continue;
      }
      // Acara baru dari kalender luar → agenda baru
      const scheduleId = this.scheduleIdFor(conn.id, change.id);
      await this.records.upsert(
        "schedule",
        scheduleId,
        { payload: mergeIntoSchedule(null, change.fields, scheduleId) },
        user,
      );
      await this.prisma.calendarEventLink.create({
        data: {
          connectionId: conn.id,
          userId: conn.userId,
          scheduleId,
          externalId: change.id,
          etag: change.etag ?? null,
          localHash: hash(fieldsKey(change.fields)),
        },
      });
      created++;
    }
    await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { syncState: state } });
    return { pulledNew: created, pulledUpdated: updated, pulledRemoved: removed };
  }

  /** Kirim perubahan agenda Akasha → kalender luar (buat, ubah, hapus). */
  private async push(conn: Conn, tz: FeedTimezone) {
    const day = today();
    const from = new Date(`${addDays(day, -SYNC_PAST_DAYS)}T00:00:00.000Z`);
    const to = new Date(`${addDays(day, SYNC_FUTURE_DAYS)}T00:00:00.000Z`);
    const rows = await this.prisma.schedule.findMany({
      where: {
        userId: conn.userId,
        deletedAt: null,
        OR: [{ startDate: { gte: from, lte: to } }, { startDate: null, date: { gte: from, lte: to } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    });
    const links = await this.prisma.calendarEventLink.findMany({ where: { connectionId: conn.id } });
    const bySchedule = new Map(links.map((l) => [l.scheduleId, l]));
    const locked = (await this.locks.lockSet(conn.userId)).records;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let budget = MAX_PUSH;
    const alive = new Set<string>();
    for (const row of rows) {
      const payload = rowToPayload(RECORD_TABLES.schedule, row as never);
      const fields = agendaFields(payload);
      if (!fields || !inWindow(fields.startDate, day)) continue;
      alive.add(row.clientId);
      const key = hash(fieldsKey(fields));
      const link = bySchedule.get(row.clientId);
      if (link && link.localHash === key) continue;
      if (budget-- <= 0) break;
      const send = locked.has(`schedule:${row.clientId}`) ? lockedFields(fields) : fields;
      const result = link
        ? await this.patchRemote(conn, link.externalId, send, tz)
        : await this.createRemote(conn, send, tz);
      if (!result) {
        // Acara luar sudah dihapus: buat ulang dengan tautan baru
        if (link) await this.prisma.calendarEventLink.delete({ where: { id: link.id } });
        const fresh = await this.createRemote(conn, send, tz);
        if (!fresh) continue;
        await this.saveLink(conn, row.clientId, fresh, key);
        created++;
        continue;
      }
      await this.saveLink(conn, row.clientId, result, key);
      if (link) updated++;
      else created++;
    }
    // Agenda yang dihapus di Akasha (atau keluar dari jendela karena dihapus) → hapus acara luar
    for (const link of links) {
      if (alive.has(link.scheduleId)) continue;
      const row = await this.scheduleRow(conn.userId, link.scheduleId);
      if (row && !row.deletedAt) continue; // masih ada, hanya di luar jendela
      await this.deleteRemote(conn, link.externalId);
      await this.prisma.calendarEventLink.delete({ where: { id: link.id } });
      deleted++;
    }
    return { pushedNew: created, pushedUpdated: updated, pushedDeleted: deleted };
  }

  private async saveLink(conn: Conn, scheduleId: string, remote: { id: string; etag?: string }, localHash: string) {
    await this.prisma.calendarEventLink.upsert({
      where: { connectionId_scheduleId: { connectionId: conn.id, scheduleId } },
      create: {
        connectionId: conn.id,
        userId: conn.userId,
        scheduleId,
        externalId: remote.id,
        etag: remote.etag ?? null,
        localHash,
      },
      update: { externalId: remote.id, etag: remote.etag ?? null, localHash },
    });
  }

  // ---------------------------------------------------------------- API penyedia

  private base(conn: Conn) {
    return this.oauth.endpoints(conn.oauthAccount.provider as OAuthProvider).api;
  }

  private calendarPath(conn: Conn) {
    const id = encodeURIComponent(conn.calendarId);
    return conn.oauthAccount.provider === "google"
      ? `${this.base(conn)}/calendars/${id}/events`
      : `${this.base(conn)}/me/calendars/${id}/events`;
  }

  private async createRemote(conn: Conn, f: AgendaFields, tz: FeedTimezone) {
    const google = conn.oauthAccount.provider === "google";
    const res = await this.oauth.api<{ id: string; etag?: string; changeKey?: string }>(
      conn.oauthAccount,
      this.calendarPath(conn),
      {
        method: "POST",
        body: google ? toGoogleEvent(f, tz) : toGraphEvent(f, tz),
      },
    );
    return { id: res.data.id, etag: google ? res.data.etag : res.data.changeKey };
  }

  /** null = acara luar sudah tidak ada. */
  private async patchRemote(conn: Conn, externalId: string, f: AgendaFields, tz: FeedTimezone) {
    const google = conn.oauthAccount.provider === "google";
    const res = await this.oauth.api<{ id: string; etag?: string; changeKey?: string }>(
      conn.oauthAccount,
      `${this.calendarPath(conn)}/${encodeURIComponent(externalId)}`,
      { method: "PATCH", body: google ? toGoogleEvent(f, tz) : toGraphEvent(f, tz), allow: [404, 410] },
    );
    if (res.status === 404 || res.status === 410) return null;
    return { id: res.data.id ?? externalId, etag: google ? res.data.etag : res.data.changeKey };
  }

  private async deleteRemote(conn: Conn, externalId: string) {
    await this.oauth.api(conn.oauthAccount, `${this.calendarPath(conn)}/${encodeURIComponent(externalId)}`, {
      method: "DELETE",
      allow: [404, 410],
    });
  }

  /** Perubahan acara sejak sinkron terakhir (Google syncToken / Microsoft delta). */
  private async remoteChanges(
    conn: Conn,
    tz: FeedTimezone,
  ): Promise<{ changes: RemoteChange[]; state: string | null }> {
    return conn.oauthAccount.provider === "google" ? this.googleChanges(conn, tz) : this.graphChanges(conn, tz);
  }

  private async googleChanges(
    conn: Conn,
    tz: FeedTimezone,
    reset = false,
  ): Promise<{ changes: RemoteChange[]; state: string | null }> {
    const changes: RemoteChange[] = [];
    let pageToken: string | undefined;
    let syncToken: string | null = null;
    const initial = reset || !conn.syncState;
    for (let page = 0; page < 20; page++) {
      const url = new URL(this.calendarPath(conn));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("maxResults", "250");
      if (initial) url.searchParams.set("timeMin", new Date(Date.now() - SYNC_PAST_DAYS * 86_400_000).toISOString());
      else url.searchParams.set("syncToken", conn.syncState!);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await this.oauth.api<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
        conn.oauthAccount,
        url.toString(),
        { allow: [410] },
      );
      // Token sinkron kedaluwarsa → sinkron penuh lagi
      if (res.status === 410) return this.googleChanges({ ...conn, syncState: null }, tz, true);
      for (const e of res.data.items ?? []) {
        changes.push({
          id: e.id,
          removed: e.status === "cancelled",
          etag: e.etag,
          updated: e.updated,
          fields: e.status === "cancelled" ? null : fromGoogleEvent(e, tz),
        });
      }
      pageToken = res.data.nextPageToken;
      if (!pageToken) {
        syncToken = res.data.nextSyncToken ?? null;
        break;
      }
    }
    return { changes, state: syncToken };
  }

  private async graphChanges(conn: Conn, tz: FeedTimezone): Promise<{ changes: RemoteChange[]; state: string | null }> {
    const changes: RemoteChange[] = [];
    let url: string;
    if (conn.syncState) url = conn.syncState;
    else {
      const u = new URL(`${this.base(conn)}/me/calendars/${encodeURIComponent(conn.calendarId)}/calendarView/delta`);
      u.searchParams.set("startDateTime", new Date(Date.now() - SYNC_PAST_DAYS * 86_400_000).toISOString());
      u.searchParams.set("endDateTime", new Date(Date.now() + (SYNC_FUTURE_DAYS + 30) * 86_400_000).toISOString());
      url = u.toString();
    }
    let deltaLink: string | null = null;
    for (let page = 0; page < 30; page++) {
      const res = await this.oauth.api<{
        value?: GraphEvent[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      }>(conn.oauthAccount, url, {
        headers: { prefer: 'odata.maxpagesize=100, outlook.body-content-type="text"' },
        allow: [410],
      });
      if (res.status === 410) {
        // deltaLink tidak berlaku lagi → ulangi dari awal
        return this.graphChanges({ ...conn, syncState: null }, tz);
      }
      for (const e of res.data.value ?? []) {
        const removed = e["@removed"] !== undefined || e.isCancelled === true;
        changes.push({
          id: e.id,
          removed,
          etag: e.changeKey,
          updated: e.lastModifiedDateTime,
          fields: removed ? null : fromGraphEvent(e, tz),
        });
      }
      if (res.data["@odata.nextLink"]) url = res.data["@odata.nextLink"];
      else {
        deltaLink = res.data["@odata.deltaLink"] ?? null;
        break;
      }
    }
    return { changes, state: deltaLink };
  }
}
