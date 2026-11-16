import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { AccessTokenPayload } from "./auth.types";

/** Sesi yang baru dipastikan masih ada tidak diperiksa ulang selama ini (hemat query; logout berlaku ≤ 10 dtk). */
const SESSION_CHECK_MS = 10_000;
const SESSION_CACHE_MAX = 5_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly alive = new Map<string, number>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  /**
   * Access token hanya berlaku selama sesinya masih ada: keluar, cabut sesi, ganti kata sandi, atau logout dari SSO
   * (back-channel) langsung mengakhiri tab yang masih terbuka, tanpa menunggu access token kedaluwarsa.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (!payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException("Token tidak valid.");
    }
    if (payload.sid && !(await this.sessionAlive(payload.sub, payload.sid)))
      throw new UnauthorizedException("Sesi sudah berakhir. Silakan masuk kembali.");
    return { id: payload.sub, email: payload.email, role: payload.role, sid: payload.sid };
  }

  private async sessionAlive(userId: string, sid: string) {
    const checkedAt = this.alive.get(sid);
    if (checkedAt && Date.now() - checkedAt < SESSION_CHECK_MS) return true;
    // Baris lama (sebelum sesi berpengenal): id token = id sesi
    const found = await this.prisma.refreshToken.findFirst({
      where: { userId, OR: [{ sessionId: sid }, { id: sid }] },
      select: { id: true },
    });
    if (!found) {
      this.alive.delete(sid);
      return false;
    }
    if (this.alive.size >= SESSION_CACHE_MAX) this.alive.clear();
    this.alive.set(sid, Date.now());
    return true;
  }
}
