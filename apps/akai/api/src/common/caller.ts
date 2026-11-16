import { createHash, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { SsoService } from "../auth/sso.service";
import { SESSION_COOKIE, needsWebHeader, readCookie } from "../auth/web-auth-logic";
import { WebSessionsService } from "../auth/web-sessions.service";
import type { Account } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseBasicAuth, parseClients } from "./caller-logic";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** `clientId` = aplikasi pemanggil (`akasha`, …) atau `web` untuk Akai web. */
export interface Caller {
  clientId: string;
  account: Account;
}

/**
 * Pemanggil Akai:
 * - aplikasi ekosistem (server ke server): HTTP Basic `client_id:client_secret` dari AKAI_CLIENTS atas nama akun SSO di
 *   header `X-Akai-Subject` (+ `X-Akai-Email`, `X-Akai-Name` opsional);
 * - Akai web: cookie sesi `akai_sid` (masuk lewat SSO). Permintaan yang mengubah data wajib header `X-Akai-Web: 1`.
 */
@Injectable()
export class CallerService {
  private readonly clients: Map<string, Buffer>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WebSessionsService,
    private readonly sso: SsoService,
    config: ConfigService,
  ) {
    this.clients = new Map(
      parseClients(config.getOrThrow<string>("AKAI_CLIENTS")).map((c) => [c.client_id, digest(c.client_secret)]),
    );
  }

  async resolve(req: Request): Promise<Caller> {
    if (req.headers.authorization?.startsWith("Basic ")) return this.resolveApp(req);
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException("Belum masuk.");
    return { clientId: "web", account: await this.resolveWeb(req, token) };
  }

  /** Akun sesi web (dipakai juga `/api/me`). Akun dinonaktifkan / akses dicabut di SSO → semua sesinya dihapus. */
  async resolveWeb(req: Request, token: string): Promise<Account> {
    if (needsWebHeader(req.method) && req.headers["x-akai-web"] !== "1")
      throw new ForbiddenException("Permintaan ditolak (header X-Akai-Web tidak ada).");
    const session = await this.sessions.resolve(token);
    if (!session) throw new UnauthorizedException("Sesi sudah berakhir. Masuk lagi.");
    if (!(await this.sso.stillAllowed(session.account.ssoSubject))) {
      await this.sessions.removeAccount(session.account.id);
      throw new UnauthorizedException("Akses Akai untuk akun ini sudah dicabut.");
    }
    return session.account;
  }

  private async resolveApp(req: Request): Promise<Caller> {
    const creds = parseBasicAuth(req.headers.authorization);
    const expected = creds && this.clients.get(creds.id);
    if (!creds || !expected || !timingSafeEqual(expected, digest(creds.secret)))
      throw new UnauthorizedException("Kredensial aplikasi tidak valid.");
    const header = (name: string) => {
      const value = req.headers[name];
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;
    };
    const subject = header("x-akai-subject");
    if (!subject) throw new BadRequestException("Header X-Akai-Subject (akun SSO) wajib diisi.");
    const email = header("x-akai-email");
    const name = header("x-akai-name");
    const account = await this.prisma.account.upsert({
      where: { ssoSubject: subject },
      create: { ssoSubject: subject, email, name },
      update: { ...(email ? { email } : {}), ...(name ? { name } : {}) },
    });
    return { clientId: creds.id, account };
  }
}
