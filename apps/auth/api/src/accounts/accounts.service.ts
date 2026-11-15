import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hash, verify } from "@node-rs/argon2";
import type { Account, EmailTokenKind } from "../generated/prisma/client";
import { type ClientInfo, hashToken, newToken } from "../common/http";
import { inviteEmail, resetPassword, verifyEmail } from "../mail/mail-templates";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeEmail, passwordProblem } from "./password-policy";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Dipakai saat email tidak terdaftar agar waktu respons sama (tidak membocorkan keberadaan akun). */
const DUMMY_HASH = hash("akun-tidak-ada-workingspace");

export interface AccountView {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  superAdmin: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  google: boolean;
  apps: { key: string; name: string; url: string; role: "admin" | "member" }[];
}

@Injectable()
export class AccountsService {
  private readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.publicUrl = config.getOrThrow<string>("PUBLIC_URL").replace(/\/+$/, "");
  }

  async view(accountId: string): Promise<AccountView> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { memberships: { include: { app: true } }, identities: { select: { provider: true } } },
    });
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      emailVerified: !!account.emailVerifiedAt,
      superAdmin: account.superAdmin,
      hasPassword: !!account.passwordHash,
      hasPin: !!account.pinHash,
      google: account.identities.some((i) => i.provider === "google"),
      apps: account.memberships
        .map((m) => ({ key: m.app.key, name: m.app.name, url: m.app.url, role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  log(accountId: string | null, event: string, info: ClientInfo = {}, detail?: object) {
    return this.prisma.securityEvent.create({
      data: { accountId, event, ip: info.ip, userAgent: info.userAgent, detail: detail ?? undefined },
    });
  }

  /** Daftar akun baru. Email yang sudah terdaftar tidak membuat akun baru dan tidak dibedakan di respons. */
  async register(input: { name: string; email: string; password: string }, info: ClientInfo) {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const problem = passwordProblem(input.password, { email, name });
    if (problem) throw new BadRequestException(problem);
    const existing = await this.prisma.account.findUnique({ where: { email } });
    if (existing) {
      // Akun ada tetapi belum terverifikasi → kirim ulang tautan; selain itu diam (tidak membocorkan keberadaan akun)
      if (!existing.emailVerifiedAt) await this.sendVerification(existing);
      return;
    }
    const selfSignup = await this.prisma.app.findMany({ where: { selfSignup: { not: null } } });
    const account = await this.prisma.account.create({
      data: {
        email,
        name,
        passwordHash: await hash(input.password),
        memberships: { create: selfSignup.map((app) => ({ appKey: app.key, role: app.selfSignup! })) },
      },
    });
    await this.log(account.id, "register", info);
    await this.sendVerification(account);
  }

  async resendVerification(rawEmail: string) {
    const account = await this.prisma.account.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (account && !account.emailVerifiedAt && !account.disabled) await this.sendVerification(account);
  }

  private async issueToken(accountId: string, kind: EmailTokenKind, ttlMs: number) {
    const token = newToken();
    await this.prisma.$transaction([
      // Tautan lama yang belum dipakai dibatalkan: hanya tautan terbaru yang berlaku
      this.prisma.emailToken.deleteMany({ where: { accountId, kind, usedAt: null } }),
      this.prisma.emailToken.create({
        data: { accountId, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
      }),
    ]);
    return token;
  }

  private async sendVerification(account: Account) {
    const token = await this.issueToken(account.id, "verify", VERIFY_TTL_MS);
    await this.mail.send(account.email, verifyEmail(account.name, `${this.publicUrl}/verify?token=${token}`));
  }

  private async consumeToken(token: string, kind: EmailTokenKind) {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date())
      throw new BadRequestException("Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.");
    const used = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw new BadRequestException("Tautan sudah dipakai.");
    return row.accountId;
  }

  async verifyEmail(token: string, info: ClientInfo) {
    const accountId = await this.consumeToken(token, "verify");
    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.log(accountId, "email_verified", info);
    return account;
  }

  /** Cek email + kata sandi. Galat yang sama untuk email tak terdaftar / kata sandi salah. */
  async authenticate(rawEmail: string, password: string, info: ClientInfo) {
    const email = normalizeEmail(rawEmail);
    const account = await this.prisma.account.findUnique({ where: { email } });
    const valid = account?.passwordHash
      ? await verify(account.passwordHash, password)
      : (await verify(await DUMMY_HASH, password), false);
    if (!account || !valid) {
      await this.log(account?.id ?? null, "login_failed", info, account ? undefined : { email });
      throw new UnauthorizedException("Email atau kata sandi salah.");
    }
    this.assertUsable(account);
    return account;
  }

  /** Akun nonaktif / belum terverifikasi tidak bisa masuk. */
  assertUsable(account: Account) {
    if (account.disabled) throw new ForbiddenException("Akun dinonaktifkan. Hubungi admin.");
    if (!account.emailVerifiedAt)
      throw new ForbiddenException({
        message: "Email belum diverifikasi. Cek kotak masuk Anda.",
        code: "EMAIL_UNVERIFIED",
      });
  }

  async markLogin(accountId: string, info: ClientInfo, method: string) {
    await this.prisma.account.update({ where: { id: accountId }, data: { lastLoginAt: new Date() } });
    await this.log(accountId, "login", info, { method });
  }

  async forgotPassword(rawEmail: string) {
    const account = await this.prisma.account.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (!account || account.disabled) return;
    const token = await this.issueToken(account.id, "reset", RESET_TTL_MS);
    await this.mail.send(account.email, resetPassword(account.name, `${this.publicUrl}/reset?token=${token}`));
  }

  /** Atur ulang kata sandi lewat tautan email → semua sesi SSO dicabut. Email ikut terverifikasi (tautan sampai ke kotak masuknya). */
  async resetPassword(token: string, password: string, info: ClientInfo) {
    const accountId = await this.consumeToken(token, "reset");
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const problem = passwordProblem(password, { email: account.email, name: account.name });
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { passwordHash: await hash(password), emailVerifiedAt: account.emailVerifiedAt ?? new Date() },
      }),
      this.prisma.authSession.deleteMany({ where: { accountId } }),
      this.prisma.oidcPayload.deleteMany({
        where: { type: "Session", payload: { path: ["accountId"], equals: accountId } },
      }),
    ]);
    await this.log(accountId, "password_reset", info);
  }

  async changePassword(
    accountId: string,
    current: string | undefined,
    next: string,
    keepSessionId: string,
    info: ClientInfo,
  ) {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.passwordHash && !(current && (await verify(account.passwordHash, current))))
      throw new BadRequestException("Kata sandi saat ini salah.");
    const problem = passwordProblem(next, { email: account.email, name: account.name });
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: accountId }, data: { passwordHash: await hash(next) } }),
      this.prisma.authSession.deleteMany({ where: { accountId, id: { not: keepSessionId } } }),
    ]);
    await this.log(accountId, "password_changed", info);
  }

  /** Tautan buat / atur ulang kata sandi dari admin (undangan akun baru = berlaku 3 hari). */
  async sendPasswordLink(account: Account, invite: boolean) {
    const token = await this.issueToken(account.id, "reset", invite ? INVITE_TTL_MS : RESET_TTL_MS);
    const url = `${this.publicUrl}/reset?token=${token}`;
    await this.mail.send(account.email, invite ? inviteEmail(account.name, url) : resetPassword(account.name, url));
  }

  /** Cabut semua sesi SSO akun (sesi halaman akun + sesi oidc-provider). Sesi di aplikasi diperiksa ulang aplikasinya. */
  async revokeAllSessions(accountId: string) {
    await this.prisma.$transaction([
      this.prisma.authSession.deleteMany({ where: { accountId } }),
      this.prisma.oidcPayload.deleteMany({
        where: { type: "Session", payload: { path: ["accountId"], equals: accountId } },
      }),
    ]);
  }

  async updateProfile(accountId: string, name: string) {
    await this.prisma.account.update({ where: { id: accountId }, data: { name: name.trim() } });
  }
}
