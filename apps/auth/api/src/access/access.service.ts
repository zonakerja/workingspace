import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppRole } from "../generated/prisma/client";
import type { ClientInfo } from "../common/http";
import {
  accessApprovedEmail,
  accessNoticeEmail,
  accessRejectedEmail,
  accessRequestedEmail,
} from "../mail/mail-templates";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  accessInfo,
  accessJson,
  cleanPurpose,
  dueNotice,
  isDurationOption,
  newExpiry,
  purposeProblem,
  requestProblem,
} from "./access-logic";

const NOTICE_INTERVAL_MS = 60 * 60 * 1000;

export interface NewRequest {
  appKey: string;
  purpose: string;
}

/**
 * Pengajuan akses aplikasi (dengan tujuan / kepentingan) dan masa akses berbatas waktu. Keputusan di tangan super admin;
 * pengingat masa akses dikirim lewat email (putaran tiap jam).
 */
@Injectable()
export class AccessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessService.name);
  private readonly publicUrl: string;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.publicUrl = config.getOrThrow<string>("PUBLIC_URL").replace(/\/+$/, "");
  }

  onModuleInit() {
    this.timer = setInterval(
      () => void this.sendNotices().catch((e) => this.logger.warn(String(e))),
      NOTICE_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Katalog aplikasi untuk formulir daftar (publik, tanpa data akun). */
  async catalog() {
    const apps = await this.prisma.app.findMany({ orderBy: { name: "asc" } });
    return apps.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      autoAccess: a.selfSignup !== null,
    }));
  }

  /** Halaman akun → Akses: semua aplikasi + status akses + pengajuan terakhir. */
  async overview(accountId: string) {
    const now = new Date();
    const [apps, memberships, requests] = await Promise.all([
      this.prisma.app.findMany({ orderBy: { name: "asc" } }),
      this.prisma.appMembership.findMany({ where: { accountId } }),
      this.prisma.accessRequest.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { app: { select: { name: true } } },
      }),
    ]);
    return {
      apps: apps.map((app) => {
        const membership = memberships.find((m) => m.appKey === app.key) ?? null;
        const pending = requests.find((r) => r.appKey === app.key && r.status === "pending") ?? null;
        const block = requestProblem({ pending: !!pending, membership }, now);
        return {
          key: app.key,
          name: app.name,
          url: app.url,
          description: app.description,
          role: membership?.role ?? null,
          access: membership ? accessJson(membership.expiresAt, now) : null,
          pendingRequestId: pending?.id ?? null,
          canRequest: !block,
          requestBlock: block,
        };
      }),
      requests: requests.map((r) => this.requestJson(r)),
    };
  }

  private requestJson(r: {
    id: string;
    appKey: string;
    app: { name: string };
    purpose: string;
    status: string;
    role: AppRole | null;
    durationDays: number | null;
    note: string | null;
    decidedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      appKey: r.appKey,
      appName: r.app.name,
      purpose: r.purpose,
      status: r.status,
      role: r.role,
      durationDays: r.durationDays,
      note: r.note,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }

  /** Validasi daftar pengajuan (formulir daftar / halaman akun) → isian bersih. Galat = BadRequest. */
  async validate(accountId: string | null, input: NewRequest[]) {
    const keys = new Set<string>();
    const out: NewRequest[] = [];
    for (const item of input) {
      if (keys.has(item.appKey)) continue;
      keys.add(item.appKey);
      const app = await this.prisma.app.findUnique({ where: { key: item.appKey } });
      if (!app) throw new BadRequestException("Aplikasi tidak ditemukan.");
      const problem = purposeProblem(item.purpose);
      if (problem) throw new BadRequestException(`${app.name}: ${problem}`);
      if (accountId) {
        const [membership, pending] = await Promise.all([
          this.prisma.appMembership.findUnique({ where: { accountId_appKey: { accountId, appKey: app.key } } }),
          this.prisma.accessRequest.count({ where: { accountId, appKey: app.key, status: "pending" } }),
        ]);
        const block = requestProblem({ pending: pending > 0, membership });
        if (block) throw new BadRequestException(`${app.name}: ${block}`);
      }
      out.push({ appKey: app.key, purpose: cleanPurpose(item.purpose) });
    }
    return out;
  }

  /** Simpan pengajuan + beri tahu super admin (akun belum terverifikasi: email admin dikirim saat email diverifikasi). */
  async create(accountId: string, input: NewRequest[], info: ClientInfo, notify = true) {
    const items = await this.validate(accountId, input);
    if (!items.length) throw new BadRequestException("Pilih aplikasi yang diajukan.");
    const created = [];
    for (const item of items) {
      created.push(await this.prisma.accessRequest.create({ data: { accountId, ...item } }));
    }
    await this.prisma.securityEvent.create({
      data: {
        accountId,
        event: "access_requested",
        ip: info.ip,
        userAgent: info.userAgent,
        detail: { apps: items.map((i) => i.appKey) },
      },
    });
    if (notify) await this.notifyAdmins(created.map((c) => c.id));
    return created.length;
  }

  /** Kirim email ke semua super admin aktif untuk pengajuan berikut. */
  async notifyAdmins(requestIds: string[]) {
    if (!requestIds.length) return;
    const [admins, requests] = await Promise.all([
      this.prisma.account.findMany({ where: { superAdmin: true, disabled: false, emailVerifiedAt: { not: null } } }),
      this.prisma.accessRequest.findMany({
        where: { id: { in: requestIds }, status: "pending" },
        include: { account: true, app: true },
      }),
    ]);
    for (const r of requests) {
      const renewal = !!(await this.prisma.appMembership.findUnique({
        where: { accountId_appKey: { accountId: r.accountId, appKey: r.appKey } },
      }));
      for (const admin of admins) {
        await this.mail
          .send(
            admin.email,
            accessRequestedEmail(
              admin.name,
              { requester: r.account.name, email: r.account.email, app: r.app.name, purpose: r.purpose, renewal },
              `${this.publicUrl}/admin#pengajuan`,
            ),
          )
          .catch((e) => this.logger.warn(`email admin gagal: ${String(e)}`));
      }
    }
  }

  /** Pengajuan menunggu dari akun yang baru memverifikasi email → beri tahu admin. */
  async notifyPendingOf(accountId: string) {
    const rows = await this.prisma.accessRequest.findMany({
      where: { accountId, status: "pending" },
      select: { id: true },
    });
    await this.notifyAdmins(rows.map((r) => r.id));
  }

  async adminList(status: "pending" | "all") {
    const now = new Date();
    const rows = await this.prisma.accessRequest.findMany({
      where: status === "pending" ? { status: "pending" } : {},
      orderBy: status === "pending" ? { createdAt: "asc" } : { createdAt: "desc" },
      take: 100,
      include: {
        app: { select: { name: true } },
        account: {
          select: {
            id: true,
            name: true,
            email: true,
            emailVerifiedAt: true,
            occupation: true,
            workplace: true,
            memberships: true,
          },
        },
      },
    });
    return rows.map((r) => {
      const membership = r.account.memberships.find((m) => m.appKey === r.appKey) ?? null;
      return {
        ...this.requestJson(r),
        account: {
          id: r.account.id,
          name: r.account.name,
          email: r.account.email,
          emailVerified: !!r.account.emailVerifiedAt,
          occupation: r.account.occupation,
          workplace: r.account.workplace,
        },
        current: membership ? { role: membership.role, access: accessJson(membership.expiresAt, now) } : null,
      };
    });
  }

  pendingCount() {
    return this.prisma.accessRequest.count({ where: { status: "pending" } });
  }

  private async pendingRequest(id: string) {
    const request = await this.prisma.accessRequest.findUnique({
      where: { id },
      include: { account: true, app: true },
    });
    if (!request) throw new NotFoundException("Pengajuan tidak ditemukan.");
    if (request.status !== "pending") throw new BadRequestException("Pengajuan sudah diputuskan.");
    return request;
  }

  async approve(id: string, adminId: string, input: { role: AppRole; days: number | null }, info: ClientInfo) {
    if (!isDurationOption(input.days)) throw new BadRequestException("Lama akses tidak valid.");
    const request = await this.pendingRequest(id);
    if (!request.account.emailVerifiedAt) throw new BadRequestException("Email pengaju belum diverifikasi.");
    const key = { accountId_appKey: { accountId: request.accountId, appKey: request.appKey } };
    const current = await this.prisma.appMembership.findUnique({ where: key });
    const expiresAt = newExpiry(input.days, current?.expiresAt);
    await this.prisma.$transaction([
      this.prisma.appMembership.upsert({
        where: key,
        create: { accountId: request.accountId, appKey: request.appKey, role: input.role, expiresAt },
        update: { role: input.role, expiresAt, expiryNotice: 0 },
      }),
      this.prisma.accessRequest.update({
        where: { id },
        data: {
          status: "approved",
          role: input.role,
          durationDays: input.days,
          decidedById: adminId,
          decidedAt: new Date(),
        },
      }),
      this.prisma.securityEvent.create({
        data: {
          accountId: request.accountId,
          event: "access_request_approved",
          ip: info.ip,
          userAgent: info.userAgent,
          detail: { by: adminId, app: request.appKey, role: input.role, expiresAt: expiresAt?.toISOString() ?? null },
        },
      }),
    ]);
    await this.mail
      .send(
        request.account.email,
        accessApprovedEmail(request.account.name, request.app.name, expiresAt, request.app.url),
      )
      .catch((e) => this.logger.warn(String(e)));
    return { expiresAt };
  }

  async reject(id: string, adminId: string, note: string | null, info: ClientInfo) {
    const request = await this.pendingRequest(id);
    const clean = note?.trim() || null;
    await this.prisma.$transaction([
      this.prisma.accessRequest.update({
        where: { id },
        data: { status: "rejected", note: clean, decidedById: adminId, decidedAt: new Date() },
      }),
      this.prisma.securityEvent.create({
        data: {
          accountId: request.accountId,
          event: "access_request_rejected",
          ip: info.ip,
          userAgent: info.userAgent,
          detail: { by: adminId, app: request.appKey },
        },
      }),
    ]);
    await this.mail
      .send(
        request.account.email,
        accessRejectedEmail(request.account.name, request.app.name, clean, `${this.publicUrl}/account#akses`),
      )
      .catch((e) => this.logger.warn(String(e)));
  }

  /** Email pengingat masa akses yang jatuh tempo (sekali per tahap). Dipanggil tiap jam; publik untuk uji. */
  async sendNotices(now = new Date()) {
    const rows = await this.prisma.appMembership.findMany({
      where: { expiresAt: { not: null }, expiryNotice: { lt: 5 } },
      include: { account: true, app: true },
    });
    let sent = 0;
    for (const m of rows) {
      const stage = dueNotice(m.expiresAt, m.expiryNotice, now);
      if (!stage || m.account.disabled) continue;
      // Klaim dulu (bersyarat) agar dua putaran tidak mengirim email yang sama
      const claimed = await this.prisma.appMembership.updateMany({
        where: { accountId: m.accountId, appKey: m.appKey, expiryNotice: m.expiryNotice },
        data: { expiryNotice: stage },
      });
      if (!claimed.count) continue;
      const info = accessInfo(m.expiresAt, now);
      await this.mail
        .send(
          m.account.email,
          accessNoticeEmail(
            m.account.name,
            { app: m.app.name, stage, expiresAt: info.expiresAt!, deleteAt: info.deleteAt! },
            `${this.publicUrl}/account#akses`,
          ),
        )
        .catch((e) => this.logger.warn(String(e)));
      sent++;
    }
    return sent;
  }
}
