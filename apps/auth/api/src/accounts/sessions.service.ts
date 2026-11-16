import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
  type ClientInfo,
  SESSION_COOKIE,
  clearSessionCookie,
  hashToken,
  newToken,
  readCookie,
  sessionCookieOptions,
} from "../common/http";
import { OidcService } from "../oidc/oidc.service";
import { PrismaService } from "../prisma/prisma.service";

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** `last_seen_at` diperbarui paling sering sekali per 5 menit per sesi (hemat tulis). */
const TOUCH_MS = 5 * 60 * 1000;

/** Sesi masuk di halaman SSO (cookie `ws_sid`). Sesi aplikasi (mis. Akasha) tetap milik aplikasi masing-masing. */
@Injectable()
export class SessionsService {
  readonly secure: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oidc: OidcService,
    config: ConfigService,
  ) {
    this.secure = config.get<boolean>("COOKIE_SECURE") ?? config.get<string>("NODE_ENV") === "production";
  }

  async create(res: Response, accountId: string, info: ClientInfo) {
    const token = newToken();
    const session = await this.prisma.authSession.create({
      data: {
        accountId,
        tokenHash: hashToken(token),
        ip: info.ip,
        userAgent: info.userAgent,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.secure, SESSION_TTL_MS));
    return session;
  }

  /** Sesi yang masih berlaku dari cookie, beserta akunnya (akun nonaktif = tidak ada sesi). */
  async current(req: Request) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { account: true },
    });
    if (!session || session.expiresAt < new Date() || session.account.disabled) return null;
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_MS)
      await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return session;
  }

  async destroy(req: Request, res: Response) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const tokenHash = hashToken(token);
      await this.oidc.notifyLogout({ authSession: { tokenHash } });
      await this.prisma.authSession.deleteMany({ where: { tokenHash } });
    }
    clearSessionCookie(res, this.secure);
  }

  list(accountId: string) {
    return this.prisma.authSession.findMany({
      where: { accountId, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  async revoke(accountId: string, sessionId: string) {
    await this.oidc.notifyLogout({ accountId, authSessionId: sessionId });
    return this.prisma.authSession.deleteMany({ where: { accountId, id: sessionId } });
  }
}
