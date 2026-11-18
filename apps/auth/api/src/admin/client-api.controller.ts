import { Controller, Get, NotFoundException, Query, Req } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import type { Request } from "express";
import { accessJson } from "../access/access-logic";
import { ClientAuthService } from "../common/client-auth";
import { PrismaService } from "../prisma/prisma.service";

class AccountQuery {
  @IsString()
  @MaxLength(60)
  sub: string;
}

/**
 * API antar-server untuk backend aplikasi. `GET /api/client/account?sub=` dipakai aplikasi saat memperbarui sesinya:
 * akun dinonaktifkan atau akses aplikasi dicabut di SSO → aplikasi mengakhiri sesinya. `access` = masa akses (baca saja
 * setelah habis, lalu berakhir → aplikasi menghapus data akun).
 */
@Controller("api/client")
export class ClientApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientAuthService,
  ) {}

  @Get("account")
  async account(@Query() query: AccountQuery, @Req() req: Request) {
    const app = this.clients.authenticate(req);
    const account = await this.prisma.account.findUnique({
      where: { id: query.sub },
      include: { memberships: { where: { appKey: app } } },
    });
    if (!account) throw new NotFoundException("Akun tidak ditemukan.");
    const membership = account.memberships[0] ?? null;
    const role = membership?.role ?? null;
    // Super admin ekosistem tidak dibatasi waktu
    const access = account.superAdmin || !membership ? accessJson(null) : accessJson(membership.expiresAt);
    return {
      sub: account.id,
      email: account.email,
      name: account.name,
      superAdmin: account.superAdmin,
      role,
      active:
        !account.disabled &&
        !!account.emailVerifiedAt &&
        (account.superAdmin || (role !== null && access.state !== "ended")),
      /** Masa akses: active | read_only (baca saja, masa beku) | ended (data boleh dihapus aplikasi) */
      access,
      hasPin: !!account.pinHash,
    };
  }
}
