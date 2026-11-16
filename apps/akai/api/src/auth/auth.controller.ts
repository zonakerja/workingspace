import { Body, Controller, Get, HttpCode, HttpException, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import type { CookieOptions, Request, Response } from "express";
import { CallerService } from "../common/caller";
import { SsoService } from "./sso.service";
import { FLOW_COOKIE, SESSION_COOKIE, isSilentSsoMiss, readCookie, ssoErrorMessage } from "./web-auth-logic";
import { WebSessionsService } from "./web-sessions.service";

const FLOW_PATH = "/api/auth/sso";

/** Masuk / keluar Akai web lewat SSO workingspace.id (docs/AKAI.md §4). */
@Controller("api")
export class AuthController {
  private readonly secure: boolean;

  constructor(
    private readonly sso: SsoService,
    private readonly sessions: WebSessionsService,
    private readonly caller: CallerService,
    config: ConfigService,
  ) {
    this.secure = config.get<boolean>("COOKIE_SECURE") ?? config.get<string>("NODE_ENV") === "production";
  }

  private cookie(path: string, maxAge?: number): CookieOptions {
    return { httpOnly: true, sameSite: "lax", secure: this.secure, path, ...(maxAge ? { maxAge } : {}) };
  }

  @Get("auth/config")
  config() {
    return { sso: this.sso.enabled };
  }

  @Get("auth/sso/start")
  async start(
    @Query("returnTo") returnTo: string | undefined,
    @Query("silent") silent: string | undefined,
    @Res() res: Response,
  ) {
    const flow = await this.sso.start(returnTo, silent === "1");
    res.cookie(FLOW_COOKIE, flow.cookie, this.cookie(FLOW_PATH, flow.maxAgeMs));
    res.redirect(302, flow.url);
  }

  @Get("auth/sso/callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const params = new URLSearchParams(query);
    const flowCookie = readCookie(req.headers.cookie, FLOW_COOKIE);
    res.clearCookie(FLOW_COOKIE, this.cookie(FLOW_PATH));
    const error = params.get("error");
    if (error) {
      if (isSilentSsoMiss(error)) return res.redirect(302, "/login?sso_checked=1");
      return res.redirect(
        302,
        `/login?sso_error=${encodeURIComponent(ssoErrorMessage(error, params.get("error_description")))}`,
      );
    }
    try {
      const { account, returnTo, sid } = await this.sso.callback(query, flowCookie);
      const session = await this.sessions.create(account.id, sid, req.headers["user-agent"]);
      res.cookie(SESSION_COOKIE, session.token, this.cookie("/", session.maxAgeMs));
      res.redirect(302, returnTo);
    } catch (e) {
      const message = e instanceof HttpException ? e.message : "Masuk gagal. Coba lagi.";
      res.redirect(302, `/login?sso_checked=1&sso_error=${encodeURIComponent(message)}`);
    }
  }

  /** Akun yang sedang masuk (401 bila belum). */
  @Get("me")
  async me(@Req() req: Request) {
    const caller = await this.caller.resolve(req);
    return {
      account: { email: caller.account.email, name: caller.account.name },
      accountUrl: this.sso.accountUrl,
    };
  }

  /** Keluar dari Akai web; jawaban membawa alamat keluar SSO (browser diarahkan ke sana = keluar dari semua aplikasi). */
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.remove(token);
    res.clearCookie(SESSION_COOKIE, this.cookie("/"));
    return { ssoLogoutUrl: await this.sso.logoutUrl() };
  }

  /** OIDC Back-Channel Logout: SSO memberi tahu sesi ber-sid ini keluar (server ke server, form-urlencoded). */
  @SkipThrottle()
  @Post("auth/sso/backchannel-logout")
  @HttpCode(200)
  async backchannel(@Body() body: { logout_token?: unknown }, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (typeof body?.logout_token !== "string") throw new HttpException("logout_token wajib.", 400);
    const { sid } = await this.sso.verifyLogoutToken(body.logout_token);
    await this.sessions.removeBySsoSid(sid);
    return {};
  }
}
