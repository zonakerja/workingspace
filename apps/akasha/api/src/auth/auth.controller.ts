import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { AuthService, type Session } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { REFRESH_COOKIE, clearRefreshCookie, readCookie, readRefreshCookie, setRefreshCookie } from "./refresh-cookie";
import { isSilentSsoMiss, ssoErrorMessage } from "./sso-logic";
import { SsoService } from "./sso.service";

/** Cookie alur masuk SSO (state, nonce, PKCE verifier bertanda tangan), hanya dikirim ke /api/v1/auth/sso. */
const SSO_FLOW_COOKIE = "akasha_sso";
const SSO_FLOW_PATH = "/api/v1/auth/sso";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly secureCookie: boolean;
  private readonly passwordLogin: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sso: SsoService,
    config: ConfigService,
  ) {
    this.secureCookie = config.getOrThrow<boolean>("COOKIE_SECURE");
    this.passwordLogin = config.get<boolean>("PASSWORD_LOGIN") ?? false;
  }

  /** Refresh token dikirim sebagai cookie httpOnly; body hanya berisi user + access token. */
  private respond(res: Response, session: Session) {
    setRefreshCookie(res, session.refreshToken, session.refreshTtlSeconds, this.secureCookie);
    return { user: session.user, accessToken: session.accessToken };
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto));
  }

  @ApiCookieAuth(REFRESH_COOKIE)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException("Sesi tidak ditemukan. Silakan login.");
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (error) {
      clearRefreshCookie(res, this.secureCookie);
      throw error;
    }
  }

  /**
   * Keluar dari Akasha. Bila SSO aktif, `ssoLogoutUrl` = halaman keluar SSO (frontend mengarahkan ke sana agar sesi akun
   * Workingspace di browser ini ikut berakhir).
   */
  @ApiCookieAuth(REFRESH_COOKIE)
  @HttpCode(200)
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res, this.secureCookie);
    return { success: true, ssoLogoutUrl: await this.sso.logoutUrl() };
  }

  /** Cara masuk yang tersedia (publik, untuk halaman login). */
  @Get("sso/config")
  ssoConfig() {
    return { enabled: this.sso.enabled, passwordLogin: this.passwordLogin, accountUrl: this.sso.accountUrl };
  }

  /** Mulai masuk lewat SSO: cookie alur + alihkan ke halaman masuk akun Workingspace. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("sso/start")
  async ssoStart(
    @Query("returnTo") returnTo: string | undefined,
    @Query("silent") silent: string | undefined,
    @Res() res: Response,
  ) {
    const flow = await this.sso.start(returnTo, silent === "1");
    res.cookie(SSO_FLOW_COOKIE, flow.cookie, {
      httpOnly: true,
      secure: this.secureCookie,
      // Lax: cookie ikut saat SSO mengarahkan kembali (navigasi tingkat atas dari situs lain)
      sameSite: "lax",
      path: SSO_FLOW_PATH,
      maxAge: flow.maxAgeMs,
    });
    res.redirect(302, flow.url);
  }

  /** Kembali dari SSO: tukar kode, buat sesi Akasha, alihkan ke halaman tujuan (galat → /login?sso_error=). */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("sso/callback")
  async ssoCallback(@Req() req: Request, @Res() res: Response) {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const flowCookie = readCookie(req, SSO_FLOW_COOKIE);
    res.clearCookie(SSO_FLOW_COOKIE, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: "lax",
      path: SSO_FLOW_PATH,
    });
    const fail = (message: string) => res.redirect(302, `/login?sso_error=${encodeURIComponent(message)}`);
    const error = params.get("error");
    // Pemeriksaan diam-diam tanpa sesi SSO → halaman masuk Akasha biasa (penanda agar tidak diperiksa ulang terus-menerus)
    if (error && isSilentSsoMiss(error)) return res.redirect(302, "/login?sso_checked=1");
    if (error) return fail(ssoErrorMessage(error, params.get("error_description")));
    try {
      const { user, returnTo, ssoSid } = await this.sso.callback(query, flowCookie);
      const session = await this.auth.sessionFor(user, ssoSid);
      setRefreshCookie(res, session.refreshToken, session.refreshTtlSeconds, this.secureCookie);
      return res.redirect(302, returnTo);
    } catch (err) {
      const message = err instanceof Error && "getStatus" in err ? err.message : "Masuk lewat akun Workingspace gagal.";
      return fail(message);
    }
  }

  /**
   * OIDC Back-Channel Logout: SSO mengirim logout token (server ke server) saat sesi SSO berakhir → sesi Akasha dari sesi SSO
   * itu dihapus. Tanpa cookie/Bearer; keaslian dari tanda tangan token. Spesifikasi: 200 + no-store, galat 400.
   */
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post("sso/backchannel-logout")
  @HttpCode(200)
  async ssoBackchannelLogout(@Body("logout_token") token: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (typeof token !== "string" || !token) throw new BadRequestException("logout_token wajib diisi.");
    const { sid, sub } = await this.sso.verifyLogoutToken(token);
    await this.auth.endSsoSession(sid, sub);
    return {};
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch("me")
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  /** Ganti password; semua sesi lain dicabut, sesi perangkat ini tetap aktif. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post("change-password")
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changePassword(user, dto, readRefreshCookie(req));
  }
}
