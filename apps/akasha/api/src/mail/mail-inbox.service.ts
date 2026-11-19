import { activeAccessWhere } from "../access/access-state";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { AiCrypto } from "../ai/ai-crypto";
import { isPrivateHost } from "../common/private-host";
import { AiIndexQueueService } from "../ai/index/ai-index-queue.service";
import { AiIndexService, type SourceDocument } from "../ai/index/ai-index.service";
import type { AuthUser } from "../common/types/auth-user";
import type { MailAccount, MailMessage } from "../generated/prisma/client";
import { ymdToDateString } from "../integrations/api-token-logic";
import { PrismaService } from "../prisma/prisma.service";
import { RecordsService } from "../records/records.service";
import { OAuthService } from "../connections/oauth.service";
import {
  detectHints,
  imapErrorMessage,
  INBOX_DAYS,
  type MailHints,
  MAX_MESSAGES_PER_ACCOUNT,
  resolveImap,
  snippetOf,
  suggestAgenda,
  suggestTodo,
  SYNC_BATCH,
  SYNC_INTERVAL_MS,
  trimBody,
} from "./inbox-logic";
import type { MailProvider } from "./mail-logic";
import { assertPublicMailHost, mailCryptoKey } from "./mail-net";

const MAIL_SOURCE = "mail_message";
const TICK_MS = 60_000;
const MESSAGE_STATUSES = ["new", "done", "ignored"] as const;
type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface InboxSettingsInput {
  enabled?: boolean;
  index?: boolean;
  days?: number;
  imapHost?: string | null;
  imapPort?: number | null;
}

type Linked = { type: "todo" | "schedule"; id: string }[];

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  internetMessageId?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  "@removed"?: unknown;
}

const todayYmd = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * Kotak masuk email (docs/AKUN-TERSAMBUNG.md tahap 1): sinkron IMAP berkala per akun (multi akun), hanya membaca — tidak pernah
 * menandai dibaca, memindah, atau menghapus email di server penyedia. Email disimpan sebagai salinan teks (tanpa berkas lampiran)
 * dengan petunjuk otomatis tagihan/jadwal; pemilik menjadikannya to-do / agenda. Opsional masuk indeks AI (chatbot & Pencarian Pintar).
 */
@Injectable()
export class MailInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailInboxService.name);
  private readonly crypto: AiCrypto;
  private readonly production: boolean;
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Akun yang sedang disinkron (cegah dua sinkron bersamaan untuk akun yang sama) */
  private readonly syncing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly aiIndex: AiIndexService,
    private readonly indexQueue: AiIndexQueueService,
    private readonly oauth: OAuthService,
    config: ConfigService,
  ) {
    this.crypto = new AiCrypto(mailCryptoKey(config.getOrThrow<string>("AI_ENCRYPTION_KEY")));
    this.production = config.get<string>("NODE_ENV") === "production";
  }

  onModuleInit() {
    this.aiIndex.registerSourceLoader(MAIL_SOURCE, {
      load: (userId, id) => this.loadSource(userId, id),
      loadAll: (userId) => this.loadAllSources(userId),
    });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- Pengaturan

  private async own(userId: string, id: string) {
    const account = await this.prisma.mailAccount.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException("Akun email tidak ditemukan.");
    return account;
  }

  async updateSettings(userId: string, accountId: string, input: InboxSettingsInput) {
    const account = await this.own(userId, accountId);
    const provider = account.provider as MailProvider;
    if (provider === "outlook" && !account.oauthAccountId)
      throw new BadRequestException("Kotak masuk Outlook butuh akun Microsoft yang disambungkan.");
    const data: Partial<MailAccount> = {};
    const imapNeeded = !account.oauthAccountId;
    if (
      imapNeeded &&
      (input.imapHost !== undefined || input.imapPort !== undefined || (input.enabled && !account.imapHost))
    ) {
      const imap = resolveImap(
        provider,
        { imapHost: input.imapHost ?? account.imapHost, imapPort: input.imapPort ?? account.imapPort },
        { isPrivate: isPrivateHost, production: this.production },
      );
      if (typeof imap === "string") throw new BadRequestException(imap);
      data.imapHost = imap.host;
      data.imapPort = imap.port;
    }
    if (input.days !== undefined) {
      if (!(INBOX_DAYS as readonly number[]).includes(input.days))
        throw new BadRequestException("Rentang hari tidak dikenal.");
      data.inboxDays = input.days;
    }
    if (typeof input.enabled === "boolean") data.inboxEnabled = input.enabled;
    if (typeof input.index === "boolean") data.inboxIndex = input.index;
    if (data.imapHost && data.imapHost !== account.imapHost) {
      // Server berganti = UID lama tidak berlaku
      data.inboxUidValidity = null;
      data.inboxLastUid = 0;
    }
    const updated = await this.prisma.mailAccount.update({ where: { id: accountId }, data });
    if (typeof input.index === "boolean" && input.index !== account.inboxIndex) await this.reindexAccount(updated);
    return updated;
  }

  /** Indeks dinyalakan = antre semua email akun; dimatikan = potongan indeksnya dihapus. */
  private async reindexAccount(account: MailAccount) {
    const ids = (
      await this.prisma.mailMessage.findMany({ where: { accountId: account.id }, select: { id: true } })
    ).map((m) => m.id);
    if (!account.inboxIndex) {
      await this.prisma.aiChunk.deleteMany({
        where: { userId: account.userId, sourceType: MAIL_SOURCE, sourceId: { in: ids } },
      });
      return;
    }
    for (const id of ids) await this.indexQueue.enqueueSource(account.userId, MAIL_SOURCE, id);
  }

  /** Dipanggil sebelum akun dihapus: potongan indeks email akun itu ikut dibuang. */
  async forgetAccount(userId: string, accountId: string) {
    const ids = (await this.prisma.mailMessage.findMany({ where: { accountId }, select: { id: true } })).map(
      (m) => m.id,
    );
    if (ids.length)
      await this.prisma.aiChunk.deleteMany({ where: { userId, sourceType: MAIL_SOURCE, sourceId: { in: ids } } });
  }

  // ---------------------------------------------------------------- Sinkron IMAP

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = new Date(Date.now() - SYNC_INTERVAL_MS);
      const accounts = await this.prisma.mailAccount.findMany({
        where: {
          inboxEnabled: true,
          user: activeAccessWhere(),
          OR: [{ inboxSyncedAt: null }, { inboxSyncedAt: { lt: due } }],
        },
        take: 20,
      });
      for (const account of accounts) {
        await this.sync(account).catch((error: unknown) =>
          this.logger.warn(
            `Sinkron kotak masuk ${account.address} gagal: ${String((error as Error).message ?? error)}`,
          ),
        );
      }
    } catch (error) {
      this.logger.error(`Penjadwal kotak masuk gagal: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Sinkron sekarang (tombol). */
  async syncNow(userId: string, accountId: string) {
    const account = await this.own(userId, accountId);
    if (!account.inboxEnabled) throw new BadRequestException("Nyalakan kotak masuk akun ini dulu.");
    return this.sync(account);
  }

  private async sync(account: MailAccount) {
    if (this.syncing.has(account.id)) throw new ConflictException("Kotak masuk akun ini sedang disinkron.");
    if (account.oauthAccountId) return this.syncGraph(account);
    this.syncing.add(account.id);
    const client = await this.connect(account).catch(async (error: unknown) => {
      this.syncing.delete(account.id);
      await this.fail(account, error);
      throw new BadRequestException(imapErrorMessage(error));
    });
    let added = 0;
    try {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const box = client.mailbox;
        const uidValidity = box ? String(box.uidValidity) : "0";
        const fresh = account.inboxUidValidity !== uidValidity;
        const since = new Date(Date.now() - account.inboxDays * 86_400_000);
        const found = fresh
          ? await client.search({ since }, { uid: true })
          : await client.search({ uid: `${account.inboxLastUid + 1}:*` }, { uid: true });
        // `n:*` selalu memuat UID terakhir walau lebih kecil dari n → saring
        const uids = (found || []).filter((u) => fresh || u > account.inboxLastUid).sort((a, b) => a - b);
        const batch = uids.slice(-SYNC_BATCH * 2).slice(0, SYNC_BATCH);
        let lastUid = fresh ? 0 : account.inboxLastUid;
        if (batch.length) {
          for await (const msg of client.fetch(
            batch.join(","),
            { uid: true, envelope: true, source: { maxLength: 2_000_000 } },
            { uid: true },
          )) {
            lastUid = Math.max(lastUid, msg.uid);
            if (await this.store(account, uidValidity, msg.uid, msg.source)) added++;
          }
        }
        // Tidak ada email baru pada sinkron pertama = mulai dari UID terbesar sekarang
        if (!batch.length && fresh && box) lastUid = Math.max(0, Number(box.uidNext ?? 1) - 1);
        await this.prisma.mailAccount.update({
          where: { id: account.id },
          data: { inboxUidValidity: uidValidity, inboxLastUid: lastUid, inboxSyncedAt: new Date(), inboxError: null },
        });
        await this.prune(account.id);
        return { added, pending: Math.max(0, uids.length - batch.length) };
      } finally {
        lock.release();
      }
    } catch (error) {
      await this.fail(account, error);
      throw new BadRequestException(imapErrorMessage(error));
    } finally {
      this.syncing.delete(account.id);
      await client.logout().catch(() => client.close());
    }
  }

  /** Kotak masuk Outlook lewat Microsoft Graph (delta pesan folder Inbox; membaca tidak menandai dibaca). */
  private async syncGraph(account: MailAccount) {
    this.syncing.add(account.id);
    let added = 0;
    try {
      const oauthAccount = await this.prisma.oAuthAccount.findUnique({ where: { id: account.oauthAccountId! } });
      if (!oauthAccount) throw new BadRequestException("Akun Microsoft tidak ditemukan. Sambungkan ulang.");
      let url: string;
      if (account.inboxCursor) url = account.inboxCursor;
      else {
        const u = new URL(`${this.oauth.endpoints("microsoft").api}/me/mailFolders/inbox/messages/delta`);
        u.searchParams.set(
          "$select",
          "subject,from,toRecipients,receivedDateTime,body,hasAttachments,internetMessageId",
        );
        u.searchParams.set(
          "$filter",
          `receivedDateTime ge ${new Date(Date.now() - account.inboxDays * 86_400_000).toISOString()}`,
        );
        url = u.toString();
      }
      let cursor: string | null = account.inboxCursor;
      let pending = false;
      for (let page = 0; page < 4; page++) {
        const res = await this.oauth.api<{
          value?: GraphMessage[];
          "@odata.nextLink"?: string;
          "@odata.deltaLink"?: string;
        }>(oauthAccount, url, {
          headers: { prefer: 'odata.maxpagesize=50, outlook.body-content-type="text"' },
          allow: [410],
        });
        if (res.status === 410) {
          await this.prisma.mailAccount.update({ where: { id: account.id }, data: { inboxCursor: null } });
          cursor = null;
          break;
        }
        for (const m of res.data.value ?? []) {
          if (m["@removed"] || !m.id) continue;
          if (await this.storeGraph(account, m)) added++;
        }
        if (res.data["@odata.nextLink"]) {
          url = res.data["@odata.nextLink"];
          cursor = url;
          pending = true;
        } else {
          cursor = res.data["@odata.deltaLink"] ?? cursor;
          pending = false;
          break;
        }
      }
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { inboxCursor: cursor, inboxSyncedAt: new Date(), inboxError: null },
      });
      await this.prune(account.id);
      return { added, pending: pending ? 1 : 0 };
    } catch (error) {
      const message = String((error as Error).message ?? error).slice(0, 300);
      await this.prisma.mailAccount
        .update({ where: { id: account.id }, data: { inboxError: message, inboxSyncedAt: new Date() } })
        .catch(() => undefined);
      throw error instanceof BadRequestException ? error : new BadRequestException(message);
    } finally {
      this.syncing.delete(account.id);
    }
  }

  private async storeGraph(account: MailAccount, m: GraphMessage) {
    const body = trimBody(
      m.body?.contentType === "text" ? (m.body.content ?? "") : (m.body?.content ?? "").replace(/<[^>]+>/g, " "),
    );
    const subject = (m.subject ?? "").slice(0, 500);
    const sentAt = m.receivedDateTime ? new Date(m.receivedDateTime) : new Date();
    const hints = detectHints(subject, body, sentAt);
    const saved = await this.prisma.mailMessage
      .upsert({
        where: { accountId_externalId: { accountId: account.id, externalId: m.id } },
        create: {
          userId: account.userId,
          accountId: account.id,
          externalId: m.id,
          messageId: m.internetMessageId?.slice(0, 500) ?? null,
          fromAddress: (m.from?.emailAddress?.address ?? "").toLowerCase().slice(0, 254) || "(tanpa pengirim)",
          fromName: m.from?.emailAddress?.name?.slice(0, 200) || null,
          toText:
            (m.toRecipients ?? [])
              .map((r) => r.emailAddress?.address)
              .filter(Boolean)
              .join(", ")
              .slice(0, 1000) || null,
          subject,
          sentAt,
          snippet: snippetOf(body),
          body,
          attachments: m.hasAttachments ? [{ name: "(ada lampiran)", size: 0, type: "" }] : [],
          hints: { ...hints },
        },
        update: {},
      })
      .catch((error: unknown) => {
        this.logger.warn(`Simpan email Outlook ${account.address} gagal: ${String(error)}`);
        return null;
      });
    if (saved && account.inboxIndex) await this.indexQueue.enqueueSource(account.userId, MAIL_SOURCE, saved.id);
    return !!saved;
  }

  private async fail(account: MailAccount, error: unknown) {
    await this.prisma.mailAccount
      .update({ where: { id: account.id }, data: { inboxError: imapErrorMessage(error), inboxSyncedAt: new Date() } })
      .catch(() => undefined);
  }

  private async connect(account: MailAccount) {
    if (!account.passwordEnc) throw new Error("Akun email belum punya sandi.");
    const imap = resolveImap(
      account.provider as MailProvider,
      { imapHost: account.imapHost, imapPort: account.imapPort },
      { isPrivate: isPrivateHost, production: this.production },
    );
    if (typeof imap === "string") throw new Error(imap);
    await assertPublicMailHost(imap.host, this.production, "IMAP");
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: imap.secure,
      auth: { user: account.smtpUser ?? account.address, pass: this.crypto.decrypt(account.passwordEnc) },
      logger: false,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
    });
    client.on("error", (error: unknown) => this.logger.warn(`IMAP ${account.address}: ${String(error)}`));
    await client.connect();
    return client;
  }

  private async store(account: MailAccount, uidValidity: string, uid: number, source?: Buffer) {
    if (!source) return false;
    const parsed = await simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
    const from = parsed.from?.value[0];
    const rawText = parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "") || "";
    const body = trimBody(rawText);
    const subject = (parsed.subject ?? "").slice(0, 500);
    const sentAt = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date();
    const hints = detectHints(subject, body, sentAt);
    const toText = Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(", ") : parsed.to?.text;
    const attachments = parsed.attachments
      .filter((a) => a.contentDisposition !== "inline")
      .slice(0, 30)
      .map((a) => ({ name: a.filename ?? "lampiran", size: a.size, type: a.contentType }));
    const saved = await this.prisma.mailMessage
      .upsert({
        where: { accountId_uidValidity_uid: { accountId: account.id, uidValidity, uid } },
        create: {
          userId: account.userId,
          accountId: account.id,
          uid,
          uidValidity,
          messageId: parsed.messageId?.slice(0, 500) ?? null,
          fromAddress: (from?.address ?? "").toLowerCase().slice(0, 254) || "(tanpa pengirim)",
          fromName: from?.name?.slice(0, 200) || null,
          toText: toText?.slice(0, 1000) ?? null,
          subject,
          sentAt,
          snippet: snippetOf(body),
          body,
          attachments,
          hints: { ...hints },
        },
        update: {},
      })
      .catch((error: unknown) => {
        this.logger.warn(`Simpan email ${account.address}#${uid} gagal: ${String(error)}`);
        return null;
      });
    if (saved && account.inboxIndex) await this.indexQueue.enqueueSource(account.userId, MAIL_SOURCE, saved.id);
    return !!saved;
  }

  /** Simpan maks. MAX_MESSAGES_PER_ACCOUNT; yang tertua dan belum dijadikan to-do/agenda dibuang. */
  private async prune(accountId: string) {
    const count = await this.prisma.mailMessage.count({ where: { accountId } });
    if (count <= MAX_MESSAGES_PER_ACCOUNT) return;
    const old = await this.prisma.mailMessage.findMany({
      where: { accountId, status: { not: "done" } },
      orderBy: { sentAt: "asc" },
      take: count - MAX_MESSAGES_PER_ACCOUNT,
      select: { id: true, userId: true },
    });
    if (!old.length) return;
    const ids = old.map((m) => m.id);
    await this.prisma.aiChunk.deleteMany({
      where: { userId: old[0].userId, sourceType: MAIL_SOURCE, sourceId: { in: ids } },
    });
    await this.prisma.mailMessage.deleteMany({ where: { id: { in: ids } } });
  }

  // ---------------------------------------------------------------- Pesan

  private summary(m: Omit<MailMessage, "body"> & { account?: { label: string; address: string } }) {
    return {
      id: m.id,
      accountId: m.accountId,
      account: m.account ? { label: m.account.label, address: m.account.address } : undefined,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      subject: m.subject,
      sentAt: m.sentAt,
      snippet: m.snippet,
      attachments: m.attachments,
      hints: m.hints as unknown as MailHints,
      status: m.status,
      linked: (m.linked as Linked | null) ?? [],
    };
  }

  async list(
    userId: string,
    query: { accountId?: string; status?: string; q?: string; before?: string; take?: number },
  ) {
    const take = Math.min(Math.max(query.take ?? 50, 1), 100);
    const status = MESSAGE_STATUSES.includes(query.status as MessageStatus)
      ? (query.status as MessageStatus)
      : undefined;
    const q = query.q?.trim().slice(0, 100);
    const before = query.before ? new Date(query.before) : undefined;
    const rows = await this.prisma.mailMessage.findMany({
      where: {
        userId,
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(status ? { status } : {}),
        ...(before && !Number.isNaN(before.getTime()) ? { sentAt: { lt: before } } : {}),
        ...(q
          ? {
              OR: [
                { subject: { contains: q, mode: "insensitive" as const } },
                { fromAddress: { contains: q, mode: "insensitive" as const } },
                { fromName: { contains: q, mode: "insensitive" as const } },
                { snippet: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: take + 1,
      omit: { body: true },
      include: { account: { select: { label: true, address: true } } },
    });
    const counts = await this.prisma.mailMessage.groupBy({ by: ["status"], where: { userId }, _count: true });
    return {
      messages: rows.slice(0, take).map((m) => this.summary(m)),
      hasMore: rows.length > take,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  private async ownMessage(userId: string, id: string) {
    const message = await this.prisma.mailMessage.findFirst({
      where: { id, userId },
      include: { account: { select: { label: true, address: true } } },
    });
    if (!message) throw new NotFoundException("Email tidak ditemukan.");
    return message;
  }

  async get(userId: string, id: string) {
    const m = await this.ownMessage(userId, id);
    const hints = m.hints as unknown as MailHints;
    const today = todayYmd();
    return {
      ...this.summary(m),
      toText: m.toText,
      body: m.body,
      suggestions: {
        todo: suggestTodo(m, hints, today),
        agenda: hints.kind === "schedule" ? suggestAgenda(m, hints, today) : null,
      },
    };
  }

  async setStatus(userId: string, id: string, status: string) {
    if (!MESSAGE_STATUSES.includes(status as MessageStatus)) throw new BadRequestException("Status tidak dikenal.");
    await this.ownMessage(userId, id);
    await this.prisma.mailMessage.update({ where: { id }, data: { status } });
    return this.get(userId, id);
  }

  private async link(id: string, current: unknown, entry: Linked[number]) {
    const linked = ((current as Linked | null) ?? []).filter((l) => !(l.type === entry.type && l.id === entry.id));
    await this.prisma.mailMessage.update({ where: { id }, data: { status: "done", linked: [...linked, entry] } });
  }

  private emailNote(m: { fromName: string | null; fromAddress: string; subject: string; sentAt: Date }) {
    const from = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
    return `Dari email ${from} (${m.sentAt.toISOString().slice(0, 10)}): ${m.subject}`;
  }

  /** Jadikan to-do (record `todo` milik user, ID tetap per email → membuat ulang = memperbarui). */
  async toTodo(user: AuthUser, id: string, input: { title: string; date: string; priority: string }) {
    const m = await this.ownMessage(user.id, id);
    const todoId = `mail-${m.id}`;
    await this.records.upsert(
      "todo",
      todoId,
      {
        payload: {
          id: todoId,
          title: input.title,
          completed: false,
          date: ymdToDateString(input.date),
          priority: input.priority,
          source: { kind: "email", messageId: m.id, note: this.emailNote(m) },
        },
      },
      user,
    );
    await this.link(m.id, m.linked, { type: "todo", id: todoId });
    return this.get(user.id, id);
  }

  /** Jadikan agenda Planner. */
  async toAgenda(
    user: AuthUser,
    id: string,
    input: { title: string; startDate: string; startTime?: string; endTime?: string },
  ) {
    const m = await this.ownMessage(user.id, id);
    const agendaId = `mail-${m.id}`;
    const timed = !!input.startTime;
    await this.records.upsert(
      "schedule",
      agendaId,
      {
        payload: {
          id: agendaId,
          title: input.title,
          startDate: input.startDate,
          endDate: input.startDate,
          date: input.startDate,
          startTime: input.startTime ?? "",
          endTime: timed ? (input.endTime ?? "") : "",
          isAllDay: !timed,
          type: "Rapat",
          description: `${this.emailNote(m)}\n\n${m.snippet}`,
        },
      },
      user,
    );
    await this.link(m.id, m.linked, { type: "schedule", id: agendaId });
    return this.get(user.id, id);
  }

  // ---------------------------------------------------------------- Indeks AI

  private document(m: MailMessage): SourceDocument {
    const from = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
    return {
      sourceType: MAIL_SOURCE,
      sourceId: m.id,
      title: m.subject || "(tanpa subjek)",
      text: `Email dari ${from}\nTanggal: ${m.sentAt.toISOString().slice(0, 10)}\nSubjek: ${m.subject}\n\n${m.body}`,
      collection: "workspace",
      metadata: { jenis: "email", from: m.fromAddress, date: m.sentAt.toISOString().slice(0, 10) },
    };
  }

  private async loadSource(userId: string, id: string) {
    const m = await this.prisma.mailMessage.findFirst({ where: { id, userId, account: { inboxIndex: true } } });
    return m ? this.document(m) : null;
  }

  private async loadAllSources(userId: string) {
    const rows = await this.prisma.mailMessage.findMany({
      where: { userId, account: { inboxIndex: true } },
      orderBy: { sentAt: "desc" },
      take: 2000,
    });
    return rows.map((m) => this.document(m));
  }
}
