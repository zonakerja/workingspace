import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Account } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SESSION_TOUCH_MS, SESSION_TTL_MS } from "./web-auth-logic";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Sesi Akai web: token acak di cookie, hash di tabel `web_sessions` (dicabut = baris dihapus). */
@Injectable()
export class WebSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, ssoSid: string | undefined, userAgent: string | undefined) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.webSession.create({
      data: {
        accountId,
        tokenHash: hashToken(token),
        ssoSid: ssoSid ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    // Bersihkan sesi kedaluwarsa milik akun ini sesekali (murah, tanpa pekerjaan berkala)
    await this.prisma.webSession.deleteMany({ where: { accountId, expiresAt: { lt: new Date() } } });
    return { token, maxAgeMs: SESSION_TTL_MS };
  }

  /** Akun untuk token sesi, atau null (tidak ada / kedaluwarsa). Masa berlaku diperpanjang paling sering tiap jam. */
  async resolve(token: string): Promise<{ id: string; account: Account } | null> {
    const session = await this.prisma.webSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { account: true },
    });
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.prisma.webSession.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_MS)
      await this.prisma.webSession
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
        })
        .catch(() => undefined);
    return { id: session.id, account: session.account };
  }

  async remove(token: string) {
    await this.prisma.webSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async removeBySsoSid(sid: string) {
    return (await this.prisma.webSession.deleteMany({ where: { ssoSid: sid } })).count;
  }

  async removeAccount(accountId: string) {
    await this.prisma.webSession.deleteMany({ where: { accountId } });
  }
}
