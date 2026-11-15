import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { AccountsService } from "../accounts/accounts.service";
import type { ClientInfo } from "../common/http";
import { PrismaService } from "../prisma/prisma.service";
import { FRESH_SESSION_MS, PIN_MAX_ATTEMPTS, isValidPin, isWeakPin, pinBlockMs } from "./pin-logic";

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * PIN keamanan satu akun untuk semua aplikasi. Diatur di halaman akun SSO; aplikasi memeriksanya lewat API antar-server.
 * Status "terbuka" tetap milik sesi tiap aplikasi (SSO hanya menjawab benar / salah).
 */
@Injectable()
export class PinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  async status(accountId: string) {
    const row = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { pinHash: true, pinBlockedUntil: true },
    });
    return {
      hasPin: !!row.pinHash,
      blockedUntil: row.pinBlockedUntil && row.pinBlockedUntil > new Date() ? row.pinBlockedUntil : null,
    };
  }

  /**
   * Bukti pemilik sebelum mengatur / menghapus PIN: kata sandi akun; akun tanpa kata sandi (Google saja) wajib
   * baru saja masuk (sesi ≤ 15 menit).
   */
  private async proveOwner(accountId: string, password: string | undefined, sessionCreatedAt: Date) {
    const row = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { passwordHash: true },
    });
    if (row.passwordHash) {
      if (!password || !(await verify(row.passwordHash, password)))
        throw new BadRequestException("Kata sandi akun salah.");
      return;
    }
    if (Date.now() - sessionCreatedAt.getTime() > FRESH_SESSION_MS)
      throw new ForbiddenException({
        message: "Demi keamanan, keluar lalu masuk lagi sebelum mengubah PIN.",
        code: "REAUTH",
      });
  }

  /** Atur PIN pertama kali, ganti, atau atur ulang PIN yang lupa (kata sandi akun = buktinya). */
  async setPin(accountId: string, pin: string, password: string | undefined, sessionCreatedAt: Date, info: ClientInfo) {
    if (!isValidPin(pin)) throw new BadRequestException("PIN harus 6 angka.");
    if (isWeakPin(pin)) throw new BadRequestException("PIN terlalu mudah ditebak (angka sama semua / berurutan).");
    await this.proveOwner(accountId, password, sessionCreatedAt);
    await this.prisma.account.update({
      where: { id: accountId },
      data: { pinHash: await hash(pin), pinFailed: 0, pinBlockedUntil: null },
    });
    await this.accounts.log(accountId, "pin_set", info);
    return this.status(accountId);
  }

  async removePin(accountId: string, password: string | undefined, sessionCreatedAt: Date, info: ClientInfo) {
    await this.proveOwner(accountId, password, sessionCreatedAt);
    await this.prisma.account.update({
      where: { id: accountId },
      data: { pinHash: null, pinFailed: 0, pinBlockedUntil: null },
    });
    await this.accounts.log(accountId, "pin_removed", info);
    return this.status(accountId);
  }

  /**
   * Periksa PIN untuk aplikasi `appKey`. Blokir bertahap dihitung bersama semua aplikasi; benar = hitungan dikosongkan.
   * Galat: 409 PIN_NOT_SET, 429 diblokir, 400 salah (dengan sisa percobaan).
   */
  async verifyPin(accountId: string, pin: string, appKey: string, info: ClientInfo) {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        pinHash: true,
        pinFailed: true,
        pinBlockedUntil: true,
        disabled: true,
        superAdmin: true,
        memberships: true,
      },
    });
    if (!row || row.disabled || (!row.superAdmin && !row.memberships.some((m) => m.appKey === appKey)))
      throw new ForbiddenException("Akun tidak aktif atau tidak punya akses ke aplikasi ini.");
    if (!row.pinHash)
      throw new ConflictException({
        message: "PIN belum diatur. Atur PIN di halaman akun Workingspace.",
        code: "PIN_NOT_SET",
      });
    const now = Date.now();
    if (row.pinBlockedUntil && row.pinBlockedUntil.getTime() > now)
      throw new HttpException(
        {
          message: `Terlalu banyak PIN salah. Coba lagi dalam ${minutes(row.pinBlockedUntil.getTime() - now)} menit.`,
          code: "PIN_BLOCKED",
          blockedUntil: row.pinBlockedUntil,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (!isValidPin(pin) || !(await verify(row.pinHash, pin))) {
      // Hitungan dinaikkan atomik: tebakan paralel tidak bisa membaca hitungan lama yang sama
      const { pinFailed: failed } = await this.prisma.account.update({
        where: { id: accountId },
        data: { pinFailed: { increment: 1 } },
        select: { pinFailed: true },
      });
      const blockMs = pinBlockMs(failed);
      if (blockMs)
        await this.prisma.account.update({
          where: { id: accountId },
          data: { pinBlockedUntil: new Date(now + blockMs) },
        });
      await this.accounts.log(accountId, blockMs ? "pin_blocked" : "pin_failed", info, { app: appKey });
      const left = PIN_MAX_ATTEMPTS - (failed % PIN_MAX_ATTEMPTS);
      throw new BadRequestException({
        message: blockMs
          ? `PIN salah. Dikunci ${minutes(blockMs)} menit.`
          : `PIN salah. Sisa ${left} percobaan sebelum dikunci sementara.`,
        code: "PIN_WRONG",
      });
    }
    if (row.pinFailed || row.pinBlockedUntil)
      await this.prisma.account.update({ where: { id: accountId }, data: { pinFailed: 0, pinBlockedUntil: null } });
    return { valid: true };
  }
}
