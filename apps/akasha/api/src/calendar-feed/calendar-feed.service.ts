import { createHash, createHmac, randomBytes } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiCrypto } from "../ai/ai-crypto";
import { PrismaService } from "../prisma/prisma.service";
import { domainDelegate } from "../records/record-delegate";
import { rowToPayload } from "../records/record-mapper";
import { RECORD_TABLES, type RecordType } from "../records/record-schema";
import { LockService } from "../security/lock.service";
import {
  addDays,
  buildCalendar,
  FEED_FUTURE_DAYS,
  FEED_PAST_DAYS,
  type FeedEvent,
  type FeedTimezone,
  isFeedTimezone,
  normalizeInclude,
  scheduleEvent,
  taskEvent,
  todoEvent,
  type FeedInclude,
} from "./ics-logic";

const CALENDAR_FEED_PATH = "/api/v1/public/calendar/";
const TOKEN_PREFIX = "cal_";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const feedKey = (aiKeyHex: string) =>
  createHmac("sha256", Buffer.from(aiKeyHex, "hex")).update("akasha:calendar-feed:v1").digest("hex");
const MAX_EVENTS = 3000;

type Row = Record<string, unknown> & { clientId: string; updatedAt: Date };

/**
 * Langganan kalender ICS (docs/AKUN-TERSAMBUNG.md tahap 0): satu alamat rahasia per akun berisi agenda, task, dan to-do milik
 * sendiri yang dilanggan Google Calendar / Outlook / kalender HP (satu arah, baca saja). Token disimpan sebagai hash (untuk
 * mencari) + terenkripsi (agar alamat bisa ditampilkan lagi ke pemilik). Item terkunci PIN hanya judulnya.
 */
@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);
  private readonly crypto: AiCrypto;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    config: ConfigService,
  ) {
    this.crypto = new AiCrypto(feedKey(config.getOrThrow<string>("AI_ENCRYPTION_KEY")));
    this.appUrl = (config.get<string>("CORS_ORIGIN") ?? "").split(",")[0].trim().replace(/\/+$/, "");
  }

  private url(token: string) {
    return `${this.appUrl}${CALENDAR_FEED_PATH}${token}.ics`;
  }

  private view(feed: {
    tokenEnc: string;
    include: unknown;
    timezone: string;
    lastAccessAt: Date | null;
    createdAt: Date;
  }) {
    return {
      enabled: true,
      url: this.url(this.crypto.decrypt(feed.tokenEnc)),
      include: normalizeInclude(feed.include),
      timezone: feed.timezone,
      lastAccessAt: feed.lastAccessAt,
      createdAt: feed.createdAt,
    };
  }

  async status(userId: string) {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { userId } });
    return feed ? this.view(feed) : { enabled: false };
  }

  private newToken() {
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    return { tokenHash: hashToken(token), tokenEnc: this.crypto.encrypt(token) };
  }

  /** Buat (bila belum ada) atau ubah pilihan isi & zona waktu. */
  async update(userId: string, input: { include?: Partial<FeedInclude>; timezone?: string }) {
    const existing = await this.prisma.calendarFeed.findUnique({ where: { userId } });
    const include = normalizeInclude({ ...normalizeInclude(existing?.include), ...(input.include ?? {}) });
    const timezone = isFeedTimezone(input.timezone) ? input.timezone : (existing?.timezone ?? "Asia/Jakarta");
    const feed = existing
      ? await this.prisma.calendarFeed.update({ where: { userId }, data: { include: { ...include }, timezone } })
      : await this.prisma.calendarFeed.create({
          data: { userId, include: { ...include }, timezone, ...this.newToken() },
        });
    return this.view(feed);
  }

  /** Ganti alamat: alamat lama langsung tidak berlaku (bila alamat tersebar). */
  async rotate(userId: string) {
    const existing = await this.prisma.calendarFeed.findUnique({ where: { userId } });
    if (!existing) throw new NotFoundException("Langganan kalender belum dibuat.");
    return this.view(await this.prisma.calendarFeed.update({ where: { userId }, data: this.newToken() }));
  }

  async remove(userId: string) {
    await this.prisma.calendarFeed.deleteMany({ where: { userId } });
    return { enabled: false };
  }

  private async rows(userId: string, type: RecordType, where: Record<string, unknown>) {
    const rows = (await domainDelegate(this.prisma, type).findMany({
      where: { userId, deletedAt: null, ...where },
      orderBy: [{ updatedAt: "desc" }],
      take: MAX_EVENTS,
    })) as unknown as Row[];
    return rows.map((row) => ({
      id: String(row.clientId),
      updatedAt: row.updatedAt,
      payload: rowToPayload(RECORD_TABLES[type], row as never),
    }));
  }

  /** Isi berkas ICS untuk token; null = token tidak dikenal (404 tanpa penjelasan). */
  async render(token: string): Promise<string | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 80) return null;
    const feed = await this.prisma.calendarFeed.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!feed) return null;
    const userId = feed.userId;
    const include = normalizeInclude(feed.include);
    const timezone: FeedTimezone = isFeedTimezone(feed.timezone) ? feed.timezone : "Asia/Jakarta";

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(`${addDays(today, -FEED_PAST_DAYS)}T00:00:00.000Z`);
    const to = new Date(`${addDays(today, FEED_FUTURE_DAYS)}T00:00:00.000Z`);
    const range = { gte: from, lte: to };
    const [locked, schedules, todos, tasks] = await Promise.all([
      this.locks.lockSet(userId).then((s) => s.records),
      include.agenda
        ? this.rows(userId, "schedule", {
            OR: [{ startDate: range }, { endDate: range }, { startDate: null, date: range }],
          })
        : [],
      include.todos ? this.rows(userId, "todo", { date: range }) : [],
      include.tasks ? this.rows(userId, "para_task", { dueDate: range }) : [],
    ]);

    // Nama Project / item Area induk task (judul saja; induk terkunci tidak disebut)
    const parentIds = [
      ...new Set(tasks.map((t) => t.payload.projectId).filter((v): v is string => typeof v === "string")),
    ];
    const parents = new Map<string, string>();
    if (parentIds.length) {
      const [projects, activities] = await Promise.all([
        this.rows(userId, "para_project", { clientId: { in: parentIds } }),
        this.rows(userId, "para_activity", { clientId: { in: parentIds } }),
      ]);
      for (const p of projects)
        if (!locked.has(`para_project:${p.id}`)) parents.set(p.id, String(p.payload.title ?? ""));
      for (const a of activities)
        if (!locked.has(`para_activity:${a.id}`)) parents.set(a.id, String(a.payload.title ?? ""));
    }

    const events: FeedEvent[] = [];
    for (const s of schedules) {
      const e = scheduleEvent(s.id, s.payload, s.updatedAt, this.appUrl, locked.has(`schedule:${s.id}`));
      if (e) events.push(e);
    }
    for (const t of todos) {
      const e = todoEvent(t.id, t.payload, t.updatedAt, this.appUrl);
      if (e) events.push(e);
    }
    for (const t of tasks) {
      const parent = typeof t.payload.projectId === "string" ? parents.get(t.payload.projectId) : undefined;
      const e = taskEvent(t.id, t.payload, t.updatedAt, this.appUrl, parent, locked.has(`para_task:${t.id}`));
      if (e) events.push(e);
    }

    // Catat akses terakhir paling sering sekali per 10 menit (aplikasi kalender meminta berulang)
    if (!feed.lastAccessAt || Date.now() - feed.lastAccessAt.getTime() > 10 * 60_000) {
      this.prisma.calendarFeed
        .update({ where: { id: feed.id }, data: { lastAccessAt: new Date() } })
        .catch((error: unknown) => this.logger.warn(`Gagal mencatat akses langganan kalender: ${String(error)}`));
    }
    return buildCalendar(events, { name: "Akasha", timezone });
  }
}
