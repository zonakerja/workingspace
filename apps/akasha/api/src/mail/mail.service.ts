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
import nodemailer from "nodemailer";
import { AiCrypto } from "../ai/ai-crypto";
import { OAuthService } from "../connections/oauth.service";
import { assertPublicMailHost, mailCryptoKey } from "./mail-net";
import { isPrivateHost } from "../common/private-host";
import { addDays, looseDate } from "../calendar-feed/ics-logic";
import type { MailAccount } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { domainDelegate } from "../records/record-delegate";
import { rowToPayload } from "../records/record-mapper";
import { RECORD_TABLES, type RecordType } from "../records/record-schema";
import { LockService } from "../security/lock.service";
import {
  buildDigest,
  type DigestItem,
  digestDue,
  isClock,
  isDigestTimezone,
  isEmail,
  isMailProvider,
  localNow,
  MAIL_PRESETS,
  MAX_MAIL_ACCOUNTS,
  type MailProvider,
  resolveSmtp,
  type SmtpSettings,
  smtpErrorMessage,
} from "./mail-logic";

const TICK_MS = 60_000;
const SEND_TIMEOUT_MS = 30_000;

export interface MailAccountInput {
  provider?: string;
  label?: string;
  address?: string;
  displayName?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  password?: string;
  isDefault?: boolean;
  digestEnabled?: boolean;
  digestTime?: string;
  digestTimezone?: string;
}

export interface OutgoingMail {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

type Row = Record<string, unknown> & { clientId: string };

/**
 * Akun email tersambung (docs/AKUN-TERSAMBUNG.md tahap 0): beberapa akun per user (Gmail lewat Sandi Aplikasi, SMTP lain), kirim
 * email, dan ringkasan harian terjadwal. Kata sandi dienkripsi (kunci turunan AI_ENCRYPTION_KEY) dan tidak pernah dikembalikan ke
 * browser. Outlook menunggu login Microsoft (tahap 2). Email masuk (IMAP) = tahap 1.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly crypto: AiCrypto;
  private readonly production: boolean;
  private readonly appUrl: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly oauth: OAuthService,
    config: ConfigService,
  ) {
    this.crypto = new AiCrypto(mailCryptoKey(config.getOrThrow<string>("AI_ENCRYPTION_KEY")));
    this.production = config.get<string>("NODE_ENV") === "production";
    this.appUrl = (config.get<string>("CORS_ORIGIN") ?? "").split(",")[0].trim().replace(/\/+$/, "");
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  presets() {
    return Object.entries(MAIL_PRESETS).map(([key, p]) => ({ key, ...p }));
  }

  private view(a: MailAccount) {
    return {
      id: a.id,
      provider: a.provider,
      authType: a.authType,
      label: a.label,
      address: a.address,
      displayName: a.displayName,
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      smtpSecure: a.smtpSecure,
      smtpUser: a.smtpUser,
      hasPassword: !!a.passwordEnc,
      isDefault: a.isDefault,
      status: a.status,
      statusMessage: a.statusMessage,
      checkedAt: a.checkedAt,
      digestEnabled: a.digestEnabled,
      digestTime: a.digestTime,
      digestTimezone: a.digestTimezone,
      digestLastSent: a.digestLastSent,
      imapHost: a.imapHost,
      imapPort: a.imapPort,
      inboxEnabled: a.inboxEnabled,
      inboxIndex: a.inboxIndex,
      inboxDays: a.inboxDays,
      inboxSyncedAt: a.inboxSyncedAt,
      inboxError: a.inboxError,
      createdAt: a.createdAt,
    };
  }

  async list(userId: string) {
    const rows = await this.prisma.mailAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return rows.map((a) => this.view(a));
  }

  private async own(userId: string, id: string) {
    const account = await this.prisma.mailAccount.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException("Akun email tidak ditemukan.");
    return account;
  }

  private settings(provider: MailProvider, input: MailAccountInput & { address: string }): SmtpSettings {
    const result = resolveSmtp(
      {
        provider,
        address: input.address,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        smtpUser: input.smtpUser,
      },
      { isPrivate: isPrivateHost, production: this.production },
    );
    if (typeof result === "string") throw new BadRequestException(result);
    return result;
  }

  private digestFields(input: MailAccountInput) {
    const data: Partial<Pick<MailAccount, "digestEnabled" | "digestTime" | "digestTimezone">> = {};
    if (typeof input.digestEnabled === "boolean") data.digestEnabled = input.digestEnabled;
    if (input.digestTime !== undefined) {
      if (!isClock(input.digestTime)) throw new BadRequestException("Jam ringkasan harus HH:mm.");
      data.digestTime = input.digestTime;
    }
    if (input.digestTimezone !== undefined) {
      if (!isDigestTimezone(input.digestTimezone)) throw new BadRequestException("Zona waktu tidak dikenal.");
      data.digestTimezone = input.digestTimezone;
    }
    return data;
  }

  async create(userId: string, input: MailAccountInput) {
    if (!isMailProvider(input.provider)) throw new BadRequestException("Penyedia email tidak dikenal.");
    const address = (input.address ?? "").trim().toLowerCase();
    if (!isEmail(address)) throw new BadRequestException("Alamat email tidak valid.");
    const smtp = this.settings(input.provider, { ...input, address });
    if (!input.password) throw new BadRequestException("Kata sandi SMTP wajib diisi.");
    const count = await this.prisma.mailAccount.count({ where: { userId } });
    if (count >= MAX_MAIL_ACCOUNTS) throw new BadRequestException(`Maksimal ${MAX_MAIL_ACCOUNTS} akun email.`);
    if (await this.prisma.mailAccount.findFirst({ where: { userId, address }, select: { id: true } }))
      throw new ConflictException("Alamat email ini sudah tersambung.");
    const account = await this.prisma.mailAccount.create({
      data: {
        userId,
        provider: input.provider,
        label: (input.label ?? "").trim().slice(0, 80) || MAIL_PRESETS[input.provider].label,
        address,
        displayName: input.displayName?.trim().slice(0, 120) || null,
        smtpHost: smtp.host,
        smtpPort: smtp.port,
        smtpSecure: smtp.secure,
        smtpUser: smtp.user,
        passwordEnc: this.crypto.encrypt(input.password),
        isDefault: count === 0 || input.isDefault === true,
        ...this.digestFields(input),
      },
    });
    if (account.isDefault && count > 0)
      await this.prisma.mailAccount.updateMany({
        where: { userId, id: { not: account.id } },
        data: { isDefault: false },
      });
    return this.view(account);
  }

  async update(userId: string, id: string, input: MailAccountInput) {
    const account = await this.own(userId, id);
    const provider = account.provider as MailProvider;
    const touchesSmtp = ["smtpHost", "smtpPort", "smtpSecure", "smtpUser"].some(
      (k) => input[k as keyof MailAccountInput] !== undefined,
    );
    const smtp = touchesSmtp
      ? this.settings(provider, {
          address: account.address,
          smtpHost: input.smtpHost ?? account.smtpHost,
          smtpPort: input.smtpPort ?? account.smtpPort,
          smtpSecure: input.smtpSecure ?? account.smtpSecure,
          smtpUser: input.smtpUser ?? account.smtpUser,
        })
      : null;
    const changesLogin = !!smtp || !!input.password;
    const updated = await this.prisma.mailAccount.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim().slice(0, 80) || account.label } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName?.trim().slice(0, 120) || null } : {}),
        ...(smtp ? { smtpHost: smtp.host, smtpPort: smtp.port, smtpSecure: smtp.secure, smtpUser: smtp.user } : {}),
        ...(input.password ? { passwordEnc: this.crypto.encrypt(input.password) } : {}),
        ...(changesLogin ? { status: "new", statusMessage: null } : {}),
        ...(input.isDefault === true ? { isDefault: true } : {}),
        ...this.digestFields(input),
      },
    });
    if (input.isDefault === true)
      await this.prisma.mailAccount.updateMany({ where: { userId, id: { not: id } }, data: { isDefault: false } });
    return this.view(updated);
  }

  /** Kirim lewat Microsoft Graph (akun Outlook OAuth). */
  private async deliverGraph(account: MailAccount, to: string[], mail: OutgoingMail) {
    const oauthAccount = await this.prisma.oAuthAccount.findUnique({ where: { id: account.oauthAccountId! } });
    if (!oauthAccount) throw new BadRequestException("Akun Microsoft tidak ditemukan. Sambungkan ulang.");
    try {
      await this.oauth.api(oauthAccount, `${this.oauth.endpoints("microsoft").api}/me/sendMail`, {
        method: "POST",
        body: {
          message: {
            subject: mail.subject.slice(0, 300),
            body: mail.html ? { contentType: "HTML", content: mail.html } : { contentType: "Text", content: mail.text },
            toRecipients: to.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        },
      });
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { status: "ok", statusMessage: null, checkedAt: new Date() },
      });
      return { messageId: "" };
    } catch (error) {
      const message = String((error as Error).message ?? error).slice(0, 300);
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { status: "error", statusMessage: message, checkedAt: new Date() },
      });
      throw new BadRequestException(message);
    }
  }

  /** Akun email Outlook dari akun Microsoft yang sudah disambungkan (OAuth, tanpa sandi). */
  async createOutlook(userId: string, oauthAccountId: string, label?: string) {
    const oauthAccount = await this.oauth.own(userId, oauthAccountId);
    if (oauthAccount.provider !== "microsoft")
      throw new BadRequestException("Hanya akun Microsoft yang bisa dipakai untuk email Outlook.");
    const existing = await this.prisma.mailAccount.findFirst({ where: { userId, address: oauthAccount.email } });
    if (existing) throw new ConflictException("Alamat email ini sudah tersambung.");
    const count = await this.prisma.mailAccount.count({ where: { userId } });
    if (count >= MAX_MAIL_ACCOUNTS) throw new BadRequestException(`Maksimal ${MAX_MAIL_ACCOUNTS} akun email.`);
    const account = await this.prisma.mailAccount.create({
      data: {
        userId,
        provider: "outlook",
        authType: "oauth",
        label: label?.trim().slice(0, 80) || "Outlook",
        address: oauthAccount.email,
        displayName: oauthAccount.displayName,
        oauthAccountId,
        isDefault: count === 0,
      },
    });
    return this.view(account);
  }

  async get(userId: string, id: string) {
    return this.view(await this.own(userId, id));
  }

  async remove(userId: string, id: string) {
    const account = await this.own(userId, id);
    await this.prisma.mailAccount.delete({ where: { id } });
    if (account.isDefault) {
      const next = await this.prisma.mailAccount.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
      if (next) await this.prisma.mailAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { ok: true };
  }

  private async transport(account: MailAccount) {
    if (!account.passwordEnc || !account.smtpHost || !account.smtpPort)
      throw new BadRequestException(
        MAIL_PRESETS[account.provider as MailProvider]?.oauthOnly ?? "Akun email belum lengkap.",
      );
    await assertPublicMailHost(account.smtpHost, this.production, "SMTP");
    return nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      requireTLS: !account.smtpSecure,
      auth: { user: account.smtpUser ?? account.address, pass: this.crypto.decrypt(account.passwordEnc) },
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });
  }

  private async deliver(account: MailAccount, mail: OutgoingMail) {
    const to = mail.to.map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!to.length || to.length > 20 || to.some((t) => !isEmail(t)))
      throw new BadRequestException("Alamat penerima tidak valid.");
    if (account.oauthAccountId) return this.deliverGraph(account, to, mail);
    const transport = await this.transport(account);
    try {
      const info = await transport.sendMail({
        from: account.displayName ? { name: account.displayName, address: account.address } : account.address,
        to,
        subject: mail.subject.slice(0, 300),
        text: mail.text,
        html: mail.html,
      });
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { status: "ok", statusMessage: null, checkedAt: new Date() },
      });
      return { messageId: info.messageId as string };
    } catch (error) {
      const message = smtpErrorMessage(error);
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { status: "error", statusMessage: message, checkedAt: new Date() },
      });
      // 422 (bukan 401/5xx): galat layanan pihak ketiga (CLAUDE.md §15)
      throw new BadRequestException(message);
    } finally {
      transport.close();
    }
  }

  /** Uji: kirim email percobaan ke alamat sendiri (atau alamat lain). */
  async test(userId: string, id: string, to?: string) {
    const account = await this.own(userId, id);
    await this.deliver(account, {
      to: [to?.trim() || account.address],
      subject: "Uji akun email Akasha",
      text: `Akun ${account.address} berhasil mengirim email dari Akasha.\n\n${this.appUrl}`,
    });
    return this.view(await this.own(userId, id));
  }

  /** Kirim email atas nama user (dipakai fitur lain & tahap berikutnya). Tanpa `accountId` = akun utama. */
  async send(userId: string, mail: OutgoingMail, accountId?: string) {
    const account = accountId
      ? await this.own(userId, accountId)
      : await this.prisma.mailAccount.findFirst({
          where: { userId },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });
    if (!account) throw new BadRequestException("Belum ada akun email tersambung (Pengaturan → Akun Tersambung).");
    return this.deliver(account, mail);
  }

  // ---------- Ringkasan harian ----------

  private async rows(userId: string, type: RecordType, where: Record<string, unknown>, take = 50) {
    const rows = (await domainDelegate(this.prisma, type).findMany({
      where: { userId, deletedAt: null, ...where },
      orderBy: [{ createdAt: "asc" }],
      take,
    })) as unknown as Row[];
    return rows.map((row) => ({ id: String(row.clientId), payload: rowToPayload(RECORD_TABLES[type], row as never) }));
  }

  async digestData(userId: string, date: string) {
    const day = new Date(`${date}T00:00:00.000Z`);
    const [user, locked, agenda, todos, tasks, overdue] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.locks.lockSet(userId).then((s) => s.records),
      this.rows(userId, "schedule", {
        OR: [
          { startDate: { lte: day }, endDate: { gte: day } },
          { startDate: day, endDate: null },
          { startDate: null, date: day },
        ],
      }),
      this.rows(userId, "todo", { date: day, completed: { not: true } }),
      this.rows(userId, "para_task", { dueDate: day, completed: { not: true } }),
      this.rows(
        userId,
        "para_task",
        { dueDate: { lt: day, gte: new Date(`${addDays(date, -60)}T00:00:00.000Z`) }, completed: { not: true } },
        20,
      ),
    ]);
    // Item terkunci PIN tidak dikirim ke luar Akasha
    const open = (type: string) => (r: { id: string }) => !locked.has(`${type}:${r.id}`);
    const title = (p: Record<string, unknown>, fallback: string) =>
      (typeof p.title === "string" && p.title.trim()) || fallback;
    const link = (q: string) => (this.appUrl ? `${this.appUrl}/overview?${q}` : undefined);
    const agendaItems: DigestItem[] = agenda.filter(open("schedule")).map(({ id, payload: p }) => {
      const start = typeof p.startTime === "string" ? p.startTime : typeof p.time === "string" ? p.time : "";
      const end = typeof p.endTime === "string" ? p.endTime : "";
      return {
        title: title(p, "Agenda"),
        note: p.isAllDay === true || !start ? "Sepanjang hari" : end ? `${start}–${end}` : start,
        url: link(`agenda=${encodeURIComponent(id)}`),
      };
    });
    agendaItems.sort((a, b) => (a.note ?? "").localeCompare(b.note ?? ""));
    const todoItems = todos
      .filter(open("todo"))
      .map(({ id, payload: p }) => ({ title: title(p, "To-do"), url: link(`todo=${encodeURIComponent(id)}`) }));
    const taskItems = tasks
      .filter(open("para_task"))
      .map(({ id, payload: p }) => ({ title: title(p, "Tugas"), url: link(`task=${encodeURIComponent(id)}`) }));
    const overdueItems = overdue.filter(open("para_task")).map(({ id, payload: p }) => {
      const due = looseDate(p.dueDate);
      const days = due ? Math.round((day.getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86_400_000) : 0;
      return {
        title: title(p, "Tugas"),
        note: days > 0 ? `Terlambat ${days} hari` : undefined,
        url: link(`task=${encodeURIComponent(id)}`),
      };
    });
    return buildDigest({
      date,
      name: user?.name ?? "",
      agenda: agendaItems,
      todos: todoItems,
      tasks: taskItems,
      overdue: overdueItems,
      appUrl: this.appUrl,
    });
  }

  /** Kirim ringkasan sekarang (tombol "Kirim contoh"); tidak menandai hari ini terkirim. */
  async sendDigestNow(userId: string, id: string) {
    const account = await this.own(userId, id);
    const { date } = localNow(
      new Date(),
      isDigestTimezone(account.digestTimezone) ? account.digestTimezone : "Asia/Jakarta",
    );
    const digest = await this.digestData(userId, date);
    await this.deliver(account, { to: [account.address], ...digest });
    return this.view(await this.own(userId, id));
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const accounts = await this.prisma.mailAccount.findMany({ where: { digestEnabled: true } });
      for (const account of accounts) {
        const date = digestDue(account, now);
        if (!date) continue;
        // Klaim bersyarat: satu kiriman per hari walau dua proses berjalan
        const claimed = await this.prisma.mailAccount.updateMany({
          where: { id: account.id, OR: [{ digestLastSent: null }, { digestLastSent: { not: date } }] },
          data: { digestLastSent: date },
        });
        if (!claimed.count) continue;
        try {
          const digest = await this.digestData(account.userId, date);
          await this.deliver(account, { to: [account.address], ...digest });
        } catch (error) {
          this.logger.warn(`Ringkasan harian ${account.address} gagal: ${String((error as Error).message ?? error)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Penjadwal ringkasan email gagal: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
