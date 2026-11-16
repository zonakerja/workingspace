import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import { User } from "../generated/prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import { durationToSeconds } from "../config/duration";
import { PrismaService } from "../prisma/prisma.service";
import { toPublicUser } from "../users/user.mapper";
import { AkaiService } from "../akai/akai.service";
import { AccessTokenPayload, RefreshTokenPayload } from "./auth.types";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { SsoService } from "./sso.service";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Refresh paralel (mis. dua tab dibuka bersamaan) memakai token yang sama: tab kedua
 * menerima token yang baru saja dirotasi. Dalam jendela ini dianggap wajar, bukan pencurian.
 */
const REUSE_GRACE_MS = 30_000;

export type Session = Awaited<ReturnType<AuthService["login"]>>;

/** Sesi token lama (baris sebelum migrasi: id token = id sesi). */
const sessionOf = (record: { id: string; sessionId: string | null; pinUnlocked: boolean; ssoSid: string | null }) => ({
  sid: record.sessionId ?? record.id,
  pinUnlocked: record.pinUnlocked,
  ssoSid: record.ssoSid,
});

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;
  private readonly refreshTtlSeconds: number;
  private readonly passwordLogin: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sso: SsoService,
    private readonly akai: AkaiService,
    config: ConfigService,
  ) {
    this.passwordLogin = config.get<boolean>("PASSWORD_LOGIN") ?? false;
    this.refreshSecret = config.getOrThrow<string>("JWT_REFRESH_SECRET");
    this.refreshTtlSeconds = durationToSeconds(config.getOrThrow<string>("JWT_REFRESH_EXPIRES_IN"));
  }

  /** User untuk browser + `aiViaAkai` (fitur AI bisa dipakai lewat Akai walau belum ada key di Pengaturan → Model AI). */
  private async publicUser(user: User) {
    return { ...toPublicUser(user), aiViaAkai: await this.akai.ready(user) };
  }

  async login(dto: LoginDto) {
    if (!this.passwordLogin)
      throw new ForbiddenException("Masuk dengan kata sandi lokal dimatikan. Gunakan Masuk dengan akun Workingspace.");
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user?.passwordHash || !(await verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("Email atau password salah.");
    }

    return this.createSession(user);
  }

  /** Rotasi refresh token. Token lama dicabut; pemakaian ulang token yang sudah dicabut mencabut semua sesi user. */
  async refresh(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (!record || record.tokenHash !== sha256(refreshToken)) {
      throw new UnauthorizedException("Refresh token tidak valid.");
    }
    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sesi sudah berakhir. Silakan login kembali.");
    }
    if (record.revokedAt) {
      if (Date.now() - record.revokedAt.getTime() <= REUSE_GRACE_MS)
        return this.createSession(record.user, sessionOf(record));
      // Token lama dipakai ulang → kemungkinan dicuri: cabut semua sesi user
      await this.revokeAllSessions(record.userId);
      throw new UnauthorizedException("Sesi sudah berakhir. Silakan login kembali.");
    }

    await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.createSession(await this.checkSsoAccount(record.user), sessionOf(record));
  }

  async logout(refreshToken: string) {
    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      const record = await this.prisma.refreshToken.findUnique({
        where: { id: payload.jti },
        select: { sessionId: true },
      });
      await this.prisma.refreshToken.deleteMany({
        where: record?.sessionId ? { OR: [{ id: payload.jti }, { sessionId: record.sessionId }] } : { id: payload.jti },
      });
    } catch {
      // Logout bersifat idempotent: token tidak valid tetap dianggap berhasil.
    }
    return { success: true };
  }

  async getProfile(authUser: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan.");
    return this.publicUser(user);
  }

  async updateProfile(authUser: AuthUser, dto: UpdateProfileDto) {
    const current = await this.prisma.user.findUnique({ where: { id: authUser.id }, select: { ssoSubject: true } });
    // Akun SSO: nama & email disalin dari akun Workingspace setiap masuk → ubah di halaman akun SSO
    if (current?.ssoSubject && (dto.name !== undefined || dto.email !== undefined))
      throw new BadRequestException("Nama dan email akun ini diubah di halaman akun Workingspace.");
    const user = await this.prisma.user.update({
      where: { id: authUser.id },
      data: { ...dto, email: dto.email?.toLowerCase() },
    });
    return this.publicUser(user);
  }

  async changePassword(authUser: AuthUser, dto: ChangePasswordDto, currentRefreshToken?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan.");
    if (!user.passwordHash)
      throw new BadRequestException("Akun ini memakai kata sandi akun Workingspace. Ganti di halaman akun SSO.");
    if (!(await verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException("Password saat ini salah.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(dto.newPassword) },
    });
    // Cabut semua sesi lain; sesi perangkat yang sedang dipakai dipertahankan
    const currentJti = currentRefreshToken
      ? await this.verifyRefreshToken(currentRefreshToken)
          .then((p) => p.jti)
          .catch(() => undefined)
      : undefined;
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, ...(currentJti ? { id: { not: currentJti } } : {}) },
    });
    return { success: true };
  }

  /**
   * Akun SSO: dinonaktifkan / akses Akasha dicabut di SSO → semua sesi Akasha diakhiri; role disamakan dengan SSO.
   * SSO tidak terjangkau = sesi dibiarkan (tidak mengeluarkan semua orang saat SSO sesaat mati).
   */
  private async checkSsoAccount(user: User): Promise<User> {
    if (!user.ssoSubject || !this.sso.enabled) return user;
    const status = await this.sso.accountStatus(user.ssoSubject);
    if (status === null) return user;
    if (status === "missing" || !status.active) {
      await this.revokeAllSessions(user.id);
      throw new UnauthorizedException("Akses akun Anda ke Akasha sudah berakhir. Silakan masuk lagi.");
    }
    const role = status.superAdmin ? "super_admin" : (status.role ?? user.role);
    if (role === user.role && status.name === user.name && status.hasPin === user.ssoPin) return user;
    return this.prisma.user.update({
      where: { id: user.id },
      data: { role, name: status.name, ssoPin: status.hasPin },
    });
  }

  /** Sesi baru setelah masuk lewat SSO (cookie diatur controller); `ssoSid` = sesi SSO asal (logout token). */
  sessionFor(user: User, ssoSid?: string) {
    return this.createSession(user, { sid: randomUUID(), pinUnlocked: false, ssoSid: ssoSid ?? null });
  }

  /**
   * Logout token dari SSO: akhiri semua sesi Akasha yang dibuka dari sesi SSO `ssoSid` (milik akun `ssoSubject` bila ada).
   * Access token sesi itu ikut ditolak (JwtStrategy memeriksa sesi masih ada).
   */
  async endSsoSession(ssoSid: string, ssoSubject?: string) {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { ssoSid, ...(ssoSubject ? { user: { ssoSubject } } : {}) },
    });
    return count;
  }

  /** Hapus semua sesi user. (`revokedAt` hanya dipakai untuk token hasil rotasi → deteksi reuse.) */
  async revokeAllSessions(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  private async verifyRefreshToken(token: string) {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException("Refresh token tidak valid.");
    }
  }

  /** Login = sesi baru (PIN tertutup); rotasi = sesi yang sama, status PIN terbuka ikut terbawa. */
  private async createSession(user: User, session?: { sid: string; pinUnlocked: boolean; ssoSid?: string | null }) {
    const sid = session?.sid ?? randomUUID();
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid,
    };
    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync(accessPayload);
    const refreshToken = await this.jwt.signAsync({ sub: user.id, jti, sid } satisfies RefreshTokenPayload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshTtlSeconds,
    });

    // Bersihkan token user yang sudah kedaluwarsa agar tabel tidak terus membesar
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
        sessionId: sid,
        pinUnlocked: session?.pinUnlocked ?? false,
        ssoSid: session?.ssoSid ?? null,
      },
    });

    return {
      user: await this.publicUser(user),
      accessToken,
      refreshToken,
      refreshTtlSeconds: this.refreshTtlSeconds,
    };
  }
}
