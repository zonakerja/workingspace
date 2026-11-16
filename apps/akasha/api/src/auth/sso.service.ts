import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as oidc from "openid-client";
import type { User } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { type SsoClaims, logoutTokenClaims, roleFromClaims, safeReturnTo } from "./sso-logic";

/** Status akun di SSO di-cache sebentar agar refresh token (tiap ± 15 menit per tab) tidak selalu memanggil SSO. */
const STATUS_TTL_MS = 60_000;
/** Cookie alur masuk (state, nonce, PKCE verifier) berlaku 10 menit. */
const FLOW_TTL_S = 10 * 60;

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export interface AccountStatus {
  active: boolean;
  role: "admin" | "member" | null;
  superAdmin: boolean;
  email: string;
  name: string;
  hasPin: boolean;
}

/**
 * Masuk Akasha lewat SSO workingspace.id (OIDC kode otorisasi + PKCE, klien confidential). Akasha tetap memegang sesinya
 * sendiri (cookie akasha_rt); SSO hanya membuktikan identitas, role, dan status akun. docs/SSO.md §2.3–§2.4.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  readonly enabled: boolean;
  private readonly issuer?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;
  private readonly postLogoutUri?: string;
  private readonly flowSecret: string;
  private discovered?: Promise<oidc.Configuration>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly statusCache = new Map<string, { at: number; value: AccountStatus | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.issuer = config.get<string>("SSO_ISSUER");
    this.clientId = config.get<string>("SSO_CLIENT_ID");
    this.clientSecret = config.get<string>("SSO_CLIENT_SECRET");
    this.redirectUri = config.get<string>("SSO_REDIRECT_URI");
    this.postLogoutUri = config.get<string>("SSO_POST_LOGOUT_URI");
    this.enabled = !!(this.issuer && this.clientId && this.clientSecret && this.redirectUri);
    this.flowSecret = `${config.getOrThrow<string>("JWT_REFRESH_SECRET")}:sso-flow`;
  }

  /** Alamat halaman akun SSO (ganti kata sandi, PIN, perangkat). */
  get accountUrl() {
    return this.issuer ? `${new URL(this.issuer).origin}/account` : null;
  }

  private config() {
    if (!this.enabled)
      throw new ServiceUnavailableException("Masuk lewat akun Workingspace belum diatur di server ini.");
    this.discovered ??= oidc
      .discovery(new URL(this.issuer!), this.clientId!, this.clientSecret!, undefined, {
        // Dev memakai http://auth.workingspace.localhost; production wajib https (divalidasi oidc-client)
        execute: new URL(this.issuer!).protocol === "http:" ? [oidc.allowInsecureRequests] : [],
      })
      .catch((error: unknown) => {
        this.discovered = undefined;
        this.logger.warn(`Discovery SSO gagal: ${String(error)}`);
        throw new ServiceUnavailableException("Layanan akun Workingspace tidak dapat dihubungi. Coba lagi sebentar.");
      });
    return this.discovered;
  }

  /** Alamat halaman masuk SSO + cookie alur (ditandatangani) yang dicek saat callback. */
  /** `silent` = periksa sesi SSO tanpa menampilkan halaman masuk (`ws_silent=1`); tidak ada sesi → callback login_required. */
  async start(returnTo: unknown, silent = false) {
    const config = await this.config();
    const flow: FlowState = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
      returnTo: safeReturnTo(returnTo),
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri!,
      scope: "openid email profile apps",
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: "S256",
      state: flow.state,
      nonce: flow.nonce,
      // Pemeriksaan diam-diam: SSO yang sudah masuk langsung melanjutkan; belum masuk → login_required tanpa halaman masuk
      ...(silent ? { ws_silent: "1" } : {}),
    });
    const cookie = await this.jwt.signAsync(flow, { secret: this.flowSecret, expiresIn: FLOW_TTL_S });
    return { url: url.href, cookie, maxAgeMs: FLOW_TTL_S * 1000 };
  }

  /** Tukar kode → klaim → akun Akasha (ditautkan / dibuat) dengan role dari SSO. */
  async callback(
    query: string,
    flowCookie: string | undefined,
  ): Promise<{ user: User; returnTo: string; ssoSid?: string }> {
    if (!flowCookie) throw new UnauthorizedException("Sesi masuk sudah kedaluwarsa. Coba masuk lagi.");
    let flow: FlowState;
    try {
      flow = await this.jwt.verifyAsync<FlowState>(flowCookie, { secret: this.flowSecret });
    } catch {
      throw new UnauthorizedException("Sesi masuk sudah kedaluwarsa. Coba masuk lagi.");
    }
    const config = await this.config();
    const current = new URL(this.redirectUri!);
    current.search = query;
    let claims: SsoClaims;
    try {
      const tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims() as unknown as SsoClaims;
    } catch (error) {
      this.logger.warn(`Callback SSO ditolak: ${String(error)}`);
      throw new UnauthorizedException("Masuk lewat akun Workingspace gagal. Coba lagi.");
    }
    let user = await this.upsertUser(claims);
    // Cermin "PIN sudah diatur" (dipakai tawaran PIN setelah masuk & penanda di aplikasi)
    const status = await this.accountStatus(claims.sub, true);
    if (status && status !== "missing" && status.hasPin !== user.ssoPin)
      user = await this.prisma.user.update({ where: { id: user.id }, data: { ssoPin: status.hasPin } });
    return { user, returnTo: flow.returnTo, ssoSid: claims.sid };
  }

  /**
   * Periksa logout token dari SSO (OIDC Back-Channel Logout): tanda tangan (JWKS SSO), iss, aud = klien Akasha, umur token,
   * lalu isi (`logoutTokenClaims`). Hasil = sid & sub, galat = BadRequest (spesifikasi: 400).
   */
  async verifyLogoutToken(token: string): Promise<{ sid: string; sub?: string }> {
    const config = await this.config();
    const meta = config.serverMetadata();
    if (!meta.jwks_uri) throw new ServiceUnavailableException("JWKS SSO tidak tersedia.");
    this.jwks ??= createRemoteJWKSet(new URL(meta.jwks_uri));
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: meta.issuer,
        audience: this.clientId,
        maxTokenAge: "5m",
      }));
    } catch (error) {
      this.logger.warn(`Logout token ditolak: ${String(error)}`);
      throw new BadRequestException("Logout token tidak valid.");
    }
    const result = logoutTokenClaims(payload);
    if ("error" in result) {
      this.logger.warn(`Logout token ditolak: ${result.error}`);
      throw new BadRequestException("Logout token tidak valid.");
    }
    return result;
  }

  /**
   * Akun Akasha untuk akun SSO: dicari dari `sso_subject`, lalu dari email (akun lama ditautkan sekali), lalu dibuat baru.
   * Nama, email, dan role disalin dari SSO setiap masuk.
   */
  private async upsertUser(claims: SsoClaims): Promise<User> {
    const role = roleFromClaims(claims, this.clientId!);
    if (!role) throw new ForbiddenException("Akun Anda belum punya akses ke Akasha. Minta admin memberi akses.");
    if (!claims.email || claims.email_verified === false)
      throw new ForbiddenException("Email akun Workingspace belum diverifikasi.");
    const email = claims.email.toLowerCase();
    const data = { email, name: claims.name?.trim() || email, role, ssoSubject: claims.sub };
    const linked = await this.prisma.user.findUnique({ where: { ssoSubject: claims.sub } });
    if (linked) return this.prisma.user.update({ where: { id: linked.id }, data });
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.ssoSubject) throw new ForbiddenException("Email ini sudah tertaut ke akun Workingspace lain.");
      return this.prisma.user.update({ where: { id: byEmail.id }, data });
    }
    return this.prisma.user.create({ data });
  }

  /** Status akun di SSO (aktif, role Akasha). null = SSO tidak menjawab (dianggap sementara, sesi dibiarkan). */
  async accountStatus(subject: string, fresh = false): Promise<AccountStatus | null | "missing"> {
    const cached = this.statusCache.get(subject);
    if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value ?? "missing";
    const base = new URL(this.issuer!).origin;
    try {
      const res = await fetch(`${base}/api/client/account?sub=${encodeURIComponent(subject)}`, {
        headers: { Authorization: this.basicAuth() },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 404) {
        this.statusCache.set(subject, { at: Date.now(), value: null });
        return "missing";
      }
      if (!res.ok) return null;
      const value = (await res.json()) as AccountStatus;
      this.statusCache.set(subject, { at: Date.now(), value });
      if (this.statusCache.size > 5000) this.statusCache.clear();
      return value;
    } catch (error) {
      this.logger.warn(`Cek status akun SSO gagal: ${String(error)}`);
      return null;
    }
  }

  private basicAuth() {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  /** Status PIN akun di SSO (selalu segar; dipakai kartu PIN & sebelum mengunci item). */
  async pinStatus(subject: string): Promise<{ hasPin: boolean; blockedUntil: string | null }> {
    const base = new URL(this.issuer!).origin;
    try {
      const res = await fetch(`${base}/api/pin/status?sub=${encodeURIComponent(subject)}`, {
        headers: { Authorization: this.basicAuth() },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { hasPin: boolean; blockedUntil: string | null };
    } catch (error) {
      this.logger.warn(`Status PIN SSO gagal: ${String(error)}`);
      throw new ServiceUnavailableException("Layanan akun Workingspace tidak dapat dihubungi. Coba lagi sebentar.");
    }
  }

  /**
   * Periksa PIN di SSO (blokir bertahap dihitung SSO untuk semua aplikasi). Galat SSO diteruskan dengan pesan & kode yang
   * sama: 400 salah, 409 PIN belum diatur, 429 diblokir, 403 tanpa akses.
   */
  async verifyPin(subject: string, pin: string) {
    const base = new URL(this.issuer!).origin;
    let res: Response;
    try {
      res = await fetch(`${base}/api/pin/verify`, {
        method: "POST",
        headers: { Authorization: this.basicAuth(), "Content-Type": "application/json" },
        body: JSON.stringify({ sub: subject, pin }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.warn(`Verifikasi PIN SSO gagal: ${String(error)}`);
      throw new ServiceUnavailableException("Layanan akun Workingspace tidak dapat dihubungi. Coba lagi sebentar.");
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    const payload = { message: body.message ?? "PIN tidak dapat diperiksa.", code: body.code };
    if (res.status === 409) throw new ConflictException(payload);
    if (res.status === 429) throw new HttpException(payload, HttpStatus.TOO_MANY_REQUESTS);
    if (res.status === 403) throw new ForbiddenException(payload);
    if (res.status === 400) throw new BadRequestException(payload);
    throw new ServiceUnavailableException("Layanan akun Workingspace tidak dapat dihubungi. Coba lagi sebentar.");
  }

  /** Alamat keluar SSO (RP-initiated logout) setelah sesi Akasha dihapus. */
  async logoutUrl(): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const config = await this.config();
      return oidc.buildEndSessionUrl(config, {
        client_id: this.clientId!,
        ...(this.postLogoutUri ? { post_logout_redirect_uri: this.postLogoutUri } : {}),
      }).href;
    } catch {
      return null;
    }
  }
}
