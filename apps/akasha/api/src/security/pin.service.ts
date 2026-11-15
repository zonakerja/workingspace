import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { SsoService } from "../auth/sso.service";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { PIN_MAX_ATTEMPTS, isValidPin, isWeakPin, pinBlockMs } from "./lock-logic";
import { LockService } from "./lock.service";

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** PIN keamanan per akun: atur/ganti (wajib kata sandi akun), buka sesi, kunci sesi, hapus. */
@Injectable()
export class PinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly sso: SsoService,
  ) {}

  /**
   * Akun yang PIN-nya dikelola SSO workingspace.id (masuk lewat SSO & SSO aktif di server ini): `sub` SSO-nya, selain
   * itu null (PIN lokal Akasha seperti sebelumnya).
   */
  private async ssoSubjectOf(userId: string) {
    if (!this.sso.enabled) return null;
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { ssoSubject: true } });
    return row?.ssoSubject ?? null;
  }

  /** PIN akun SSO diatur di halaman akun Workingspace, bukan di Akasha. */
  private ssoManaged(): never {
    throw new ConflictException({
      message: "PIN akun ini diatur di halaman akun Workingspace.",
      code: "PIN_IN_SSO",
      accountUrl: this.sso.accountUrl,
    });
  }

  async status(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { pinHash: true, pinBlockedUntil: true, ssoSubject: true, ssoPin: true },
    });
    const set = await this.locks.lockSet(user.id);
    let hasPin = !!row.pinHash;
    let blockedUntil: Date | string | null =
      row.pinBlockedUntil && row.pinBlockedUntil > new Date() ? row.pinBlockedUntil : null;
    const managedBySso = !!row.ssoSubject && this.sso.enabled;
    if (managedBySso) {
      const remote = await this.sso.pinStatus(row.ssoSubject!);
      hasPin = remote.hasPin;
      blockedUntil = remote.blockedUntil;
      if (remote.hasPin !== row.ssoPin)
        await this.prisma.user.update({ where: { id: user.id }, data: { ssoPin: remote.hasPin } });
    }
    return {
      hasPin,
      unlocked: hasPin && (await this.locks.isUnlocked(user)),
      blockedUntil,
      /** PIN diatur di halaman akun Workingspace (`accountUrl`), bukan di Akasha */
      managedBySso,
      accountUrl: managedBySso ? this.sso.accountUrl : null,
      lockedItems: set.roots + set.notebooks.size,
      /** Sesi ini bisa memakai PIN (token agen tidak) */
      sessionCapable: !!user.sid,
    };
  }

  /** Atur PIN pertama kali atau ganti PIN. Kata sandi akun wajib; sesi lain dikunci kembali. */
  async setPin(user: AuthUser, password: string, pin: string) {
    if (await this.ssoSubjectOf(user.id)) this.ssoManaged();
    if (!isValidPin(pin)) throw new BadRequestException("PIN harus 6 angka.");
    if (isWeakPin(pin)) throw new BadRequestException("PIN terlalu mudah ditebak (angka sama semua / berurutan).");
    await this.checkPassword(user.id, password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinHash: await hash(pin), pinFailed: 0, pinBlockedUntil: null },
    });
    await this.locks.lockAllSessions(user.id);
    // Pengatur PIN baru saja membuktikan diri → sesi ini dibiarkan terbuka
    await this.locks.setSessionUnlocked(user, true);
    return this.status(user);
  }

  async unlock(user: AuthUser, pin: string) {
    if (!user.sid) throw new BadRequestException("Sesi ini tidak bisa membuka PIN. Login ulang lalu coba lagi.");
    await this.checkPin(user.id, pin);
    await this.locks.setSessionUnlocked(user, true);
    return this.status(user);
  }

  /**
   * PIN untuk satu tindakan penting (mis. Kirim Konsep SRIKANDI): wajib diketik setiap kali, walau sesi sudah terbuka, dan
   * hanya dari sesi login di browser (token agen / MCP tidak pernah bisa). Salah PIN dihitung dan diblokir bertahap sama
   * dengan membuka item. Status sesi tidak diubah.
   */
  async confirmAction(user: AuthUser, pin: string | undefined) {
    if (!user.sid)
      throw new ForbiddenException("Tindakan ini hanya bisa dilakukan pemilik dari aplikasi Akasha (bukan agen).");
    if (!pin) throw new BadRequestException("Masukkan PIN keamanan untuk melanjutkan.");
    await this.checkPin(user.id, pin);
  }

  /** Periksa PIN akun: blokir bertahap setelah salah berulang; benar = hitungan salah dikosongkan. */
  private async checkPin(userId: string, pin: string) {
    const subject = await this.ssoSubjectOf(userId);
    if (subject) return this.sso.verifyPin(subject, pin);
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pinHash: true, pinFailed: true, pinBlockedUntil: true },
    });
    if (!row.pinHash) throw new BadRequestException("PIN belum diatur. Atur PIN di Profil Saya.");
    const now = Date.now();
    if (row.pinBlockedUntil && row.pinBlockedUntil.getTime() > now) {
      throw new HttpException(
        `Terlalu banyak PIN salah. Coba lagi dalam ${minutes(row.pinBlockedUntil.getTime() - now)} menit.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!isValidPin(pin) || !(await verify(row.pinHash, pin))) {
      // Hitungan dinaikkan atomik: tebakan paralel tidak bisa membaca hitungan lama yang sama
      const { pinFailed: failed } = await this.prisma.user.update({
        where: { id: userId },
        data: { pinFailed: { increment: 1 } },
        select: { pinFailed: true },
      });
      const blockMs = pinBlockMs(failed);
      if (blockMs) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { pinBlockedUntil: new Date(now + blockMs) },
        });
      }
      const left = PIN_MAX_ATTEMPTS - (failed % PIN_MAX_ATTEMPTS);
      throw new BadRequestException(
        blockMs
          ? `PIN salah. Dikunci ${minutes(blockMs)} menit.`
          : `PIN salah. Sisa ${left} percobaan sebelum dikunci sementara.`,
      );
    }
    await this.prisma.user.update({ where: { id: userId }, data: { pinFailed: 0, pinBlockedUntil: null } });
  }

  async lock(user: AuthUser) {
    await this.locks.setSessionUnlocked(user, false);
    return this.status(user);
  }

  /** Hapus PIN: kata sandi akun wajib dan tidak boleh ada item yang masih terkunci. */
  async removePin(user: AuthUser, password: string) {
    if (await this.ssoSubjectOf(user.id)) this.ssoManaged();
    await this.checkPassword(user.id, password);
    const set = await this.locks.lockSet(user.id);
    if (set.records.size || set.notebooks.size) {
      throw new ConflictException(
        "Masih ada item terkunci (termasuk arsip PARA dari item terkunci). Lepas kunci semua item lebih dulu; arsip terkunci dipulihkan dulu lalu dilepas kuncinya.",
      );
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinHash: null, pinFailed: 0, pinBlockedUntil: null },
    });
    await this.locks.lockAllSessions(user.id);
    return this.status(user);
  }

  /** Pemilik bisa mengunci item: PIN harus sudah diatur. */
  async assertHasPin(userId: string) {
    const subject = await this.ssoSubjectOf(userId);
    if (subject) {
      if (!(await this.sso.pinStatus(subject)).hasPin)
        throw new BadRequestException("Atur PIN keamanan di halaman akun Workingspace sebelum mengunci item.");
      return;
    }
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } });
    if (!row?.pinHash) throw new BadRequestException("Atur PIN keamanan di Profil Saya sebelum mengunci item.");
  }

  /** Konfirmasi pemilik untuk akun tanpa kata sandi lokal (akun SSO): PIN keamanan. Dipakai brankas kredensial robot. */
  async confirmOwner(userId: string, pin: string | undefined) {
    if (!pin) throw new BadRequestException("Masukkan PIN keamanan untuk konfirmasi.");
    await this.checkPin(userId, pin);
  }

  private async checkPassword(userId: string, password: string) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!row.passwordHash)
      throw new BadRequestException(
        "Akun ini masuk lewat SSO workingspace.id dan tidak punya kata sandi lokal. Konfirmasi dengan PIN akan menggantikannya (B2 langkah berikutnya).",
      );
    if (!(await verify(row.passwordHash, password))) throw new BadRequestException("Kata sandi akun salah.");
  }
}
