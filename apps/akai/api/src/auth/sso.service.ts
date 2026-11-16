import { createHmac } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import * as oidc from "openid-client";
import type { Account } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FLOW_TTL_S, type SsoClaims, hasAppAccess, logoutTokenClaims, safeReturnTo } from "./web-auth-logic";

/** Status akun di SSO di-cache sebentar agar setiap permintaan web tidak selalu memanggil SSO. */
const STATUS_TTL_MS = 60_000;

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

interface AccountStatus {
  active: boolean;
  role: "admin" | "member" | null;
  superAdmin: boolean;
}

/**
 * Masuk Akai web lewat SSO workingspace.id (OIDC kode + PKCE, klien confidential `akai`). Akai memegang sesinya sendiri
 * (cookie `akai_sid`); SSO membuktikan identitas & akses. Pola sama dengan Akasha (docs/SSO.md §2.3–§2.4, §2.11).
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  readonly enabled: boolean;
  private readonly issuer?: string;
  private readonly clientId: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;
  private readonly postLogoutUri?: string;
  private readonly flowKey: Uint8Array;
  private discovered?: Promise<oidc.Configuration>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly statusCache = new Map<string, { at: number; value: AccountStatus | "missing" }>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.issuer = config.get<string>("SSO_ISSUER");
    this.clientId = config.get<string>("SSO_CLIENT_ID") ?? "akai";
    this.clientSecret = config.get<string>("SSO_CLIENT_SECRET");
    this.redirectUri = config.get<string>("SSO_REDIRECT_URI");
    this.postLogoutUri = config.get<string>("SSO_POST_LOGOUT_URI");
    this.enabled = !!(this.issuer && this.clientSecret && this.redirectUri);
    this.flowKey = createHmac("sha256", config.getOrThrow<string>("AKAI_ENCRYPTION_KEY"))
      .update("akai:sso-flow:v1")
      .digest();
  }

  /** Alamat halaman akun SSO (profil, kata sandi, PIN, perangkat). */
  get accountUrl() {
    return this.issuer ? `${new URL(this.issuer).origin}/account` : null;
  }

  private config() {
    if (!this.enabled)
      throw new ServiceUnavailableException("Masuk lewat akun Workingspace belum diatur di server ini.");
    this.discovered ??= oidc
      .discovery(new URL(this.issuer!), this.clientId, this.clientSecret!, undefined, {
        execute: new URL(this.issuer!).protocol === "http:" ? [oidc.allowInsecureRequests] : [],
      })
      .catch((error: unknown) => {
        this.discovered = undefined;
        this.logger.warn(`Discovery SSO gagal: ${String(error)}`);
        throw new ServiceUnavailableException("Layanan akun Workingspace tidak dapat dihubungi. Coba lagi sebentar.");
      });
    return this.discovered;
  }

  /** Alamat halaman masuk SSO + cookie alur bertanda tangan. `silent` = periksa sesi SSO tanpa halaman masuk. */
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
      ...(silent ? { ws_silent: "1" } : {}),
    });
    const cookie = await new SignJWT({ ...flow })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(`${FLOW_TTL_S}s`)
      .sign(this.flowKey);
    return { url: url.href, cookie, maxAgeMs: FLOW_TTL_S * 1000 };
  }

  /** Tukar kode → klaim → akun Akai (dibuat / diperbarui dari sub SSO). */
  async callback(
    query: string,
    flowCookie: string | undefined,
  ): Promise<{ account: Account; returnTo: string; sid?: string }> {
    if (!flowCookie) throw new UnauthorizedException("Sesi masuk sudah kedaluwarsa. Coba masuk lagi.");
    let flow: FlowState;
    try {
      flow = (await jwtVerify(flowCookie, this.flowKey, { algorithms: ["HS256"] })).payload as unknown as FlowState;
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
    if (!hasAppAccess(claims, this.clientId))
      throw new ForbiddenException("Akun Anda belum punya akses ke Akai. Minta admin memberi akses.");
    const email = claims.email?.toLowerCase() ?? null;
    const name = claims.name?.trim() || email;
    const account = await this.prisma.account.upsert({
      where: { ssoSubject: claims.sub },
      create: { ssoSubject: claims.sub, email, name },
      update: { email, name },
    });
    this.statusCache.delete(claims.sub);
    return { account, returnTo: flow.returnTo, sid: claims.sid };
  }

  /** Logout token dari SSO (OIDC Back-Channel Logout): tanda tangan, iss, aud = klien Akai, umur ≤ 5 menit, isi. */
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
   * Akun masih aktif & punya akses Akai di SSO? `false` = tidak (sesi web dihapus), `true` = ya, atau SSO tidak menjawab
   * (dianggap sementara: sesi dibiarkan). Di-cache 60 detik.
   */
  async stillAllowed(subject: string): Promise<boolean> {
    if (!this.enabled) return true;
    const cached = this.statusCache.get(subject);
    let value = cached && Date.now() - cached.at < STATUS_TTL_MS ? cached.value : undefined;
    if (!value) {
      try {
        const res = await fetch(
          `${new URL(this.issuer!).origin}/api/client/account?sub=${encodeURIComponent(subject)}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
            },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (res.status === 404) value = "missing";
        else if (res.ok) value = (await res.json()) as AccountStatus;
        else return true;
      } catch (error) {
        this.logger.warn(`Cek status akun SSO gagal: ${String(error)}`);
        return true;
      }
      this.statusCache.set(subject, { at: Date.now(), value });
      if (this.statusCache.size > 5000) this.statusCache.clear();
    }
    if (value === "missing") return false;
    return value.active && (value.superAdmin || value.role === "admin" || value.role === "member");
  }

  /** Alamat keluar SSO (RP-initiated logout) setelah sesi Akai dihapus. */
  async logoutUrl(): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const config = await this.config();
      return oidc.buildEndSessionUrl(config, {
        client_id: this.clientId,
        ...(this.postLogoutUri ? { post_logout_redirect_uri: this.postLogoutUri } : {}),
      }).href;
    } catch {
      return null;
    }
  }
}
