import type { Adapter, AdapterPayload } from "oidc-provider";
import { Prisma } from "../generated/prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Penyimpanan oidc-provider (sesi, kode otorisasi, grant, interaksi, refresh token, …) di satu tabel `oidc_payloads`.
 * Kunci = (type, id). Baris kedaluwarsa disapu berkala oleh OidcService.
 */
export function createOidcAdapter(prisma: PrismaService): new (name: string) => Adapter {
  PrismaOidcAdapter.prisma = prisma;
  return PrismaOidcAdapter;
}

class PrismaOidcAdapter implements Adapter {
  static prisma: PrismaService;
  constructor(private readonly type: string) {}

  private live(row: { payload: Prisma.JsonValue; expiresAt: Date | null; consumedAt: Date | null } | null) {
    if (!row || (row.expiresAt && row.expiresAt < new Date())) return undefined;
    return {
      ...(row.payload as AdapterPayload),
      ...(row.consumedAt ? { consumed: Math.floor(row.consumedAt.getTime() / 1000) } : {}),
    };
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
    const data = {
      payload: payload as Prisma.InputJsonValue,
      grantId: payload.grantId ?? null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
    await PrismaOidcAdapter.prisma.oidcPayload.upsert({
      where: { type_id: { type: this.type, id } },
      create: { id, type: this.type, ...data },
      update: data,
    });
  }

  async find(id: string) {
    return this.live(
      await PrismaOidcAdapter.prisma.oidcPayload.findUnique({ where: { type_id: { type: this.type, id } } }),
    );
  }

  async findByUserCode(userCode: string) {
    return this.live(await PrismaOidcAdapter.prisma.oidcPayload.findFirst({ where: { type: this.type, userCode } }));
  }

  async findByUid(uid: string) {
    return this.live(await PrismaOidcAdapter.prisma.oidcPayload.findFirst({ where: { type: this.type, uid } }));
  }

  async consume(id: string) {
    await PrismaOidcAdapter.prisma.oidcPayload.updateMany({
      where: { type: this.type, id },
      data: { consumedAt: new Date() },
    });
  }

  async destroy(id: string) {
    await PrismaOidcAdapter.prisma.oidcPayload.deleteMany({ where: { type: this.type, id } });
  }

  async revokeByGrantId(grantId: string) {
    await PrismaOidcAdapter.prisma.oidcPayload.deleteMany({ where: { grantId } });
  }
}
