import { createHmac, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiCrypto } from "../ai/ai-crypto";
import type { OAuthAccount } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  authorizeUrl,
  hasDriveScope,
  isRevoked,
  type OAuthEndpoints,
  type OAuthProvider,
  OAUTH_PROVIDERS,
  oauthEndpoints,
  parseTokenResponse,
  profileIdentity,
  type StoredToken,
  tokenExpired,
} from "./oauth-logic";

const STATE_TTL_MS = 10 * 60_000;
const oauthKey = (aiKeyHex: string) =>
  createHmac("sha256", Buffer.from(aiKeyHex, "hex")).update("akasha:oauth-account:v1").digest("hex");

/** Galat penyedia (Google/Microsoft) yang diteruskan ke klien sebagai 400/422 — bukan 401 / ≥ 502 (CLAUDE.md §15). */
export class ProviderError extends BadRequestException {}

/**
 * Akun Google / Microsoft lewat OAuth (docs/AKUN-TERSAMBUNG.md tahap 2): halaman izin penyedia dengan PKCE, token disimpan
 * terenkripsi (kunci turunan `akasha:oauth-account:v1`) dan diperbarui otomatis. Status izin di memori satu proses (10 menit).
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly crypto: AiCrypto;
  private readonly appUrl: string;
  private readonly testBase?: string;
  private readonly tenant?: string;
  private readonly clients: Partial<Record<OAuthProvider, { id: string; secret: string }>>;
  private readonly pending = new Map<
    string,
    { userId: string; provider: OAuthProvider; verifier: string; at: number; drive: boolean }
  >();
  /** Pembaruan token per akun yang sedang berjalan (cegah dua refresh bersamaan) */
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.crypto = new AiCrypto(oauthKey(config.getOrThrow<string>("AI_ENCRYPTION_KEY")));
    this.appUrl = (config.get<string>("CORS_ORIGIN") ?? "").split(",")[0].trim().replace(/\/+$/, "");
    this.testBase = config.get<string>("OAUTH_TEST_BASE") || undefined;
    this.tenant = config.get<string>("MICROSOFT_OAUTH_TENANT") || undefined;
    const pair = (id?: string, secret?: string) => (id && secret ? { id, secret } : undefined);
    this.clients = {
      google: pair(config.get("GOOGLE_OAUTH_CLIENT_ID"), config.get("GOOGLE_OAUTH_CLIENT_SECRET")),
      microsoft: pair(config.get("MICROSOFT_OAUTH_CLIENT_ID"), config.get("MICROSOFT_OAUTH_CLIENT_SECRET")),
    };
  }

  get redirectUri() {
    return `${this.appUrl}/api/v1/connections/oauth/callback`;
  }

  endpoints(provider: OAuthProvider): OAuthEndpoints {
    return oauthEndpoints(provider, { tenant: this.tenant, testBase: this.testBase });
  }

  configured() {
    return Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, !!this.clients[p]])) as Record<OAuthProvider, boolean>;
  }

  private client(provider: OAuthProvider) {
    const c = this.clients[provider];
    if (!c)
      throw new BadRequestException(
        provider === "google"
          ? "OAuth client Google belum diatur di server (GOOGLE_OAUTH_CLIENT_ID / _SECRET)."
          : "App Microsoft belum diatur di server (MICROSOFT_OAUTH_CLIENT_ID / _SECRET).",
      );
    return c;
  }

  view(a: OAuthAccount) {
    return {
      id: a.id,
      provider: a.provider,
      email: a.email,
      displayName: a.displayName,
      scopes: a.scopes.split(" ").filter(Boolean),
      drive: hasDriveScope(a.provider as OAuthProvider, a.scopes),
      status: a.status,
      statusMessage: a.statusMessage,
      createdAt: a.createdAt,
    };
  }

  async list(userId: string) {
    return this.prisma.oAuthAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  }

  async own(userId: string, id: string) {
    const account = await this.prisma.oAuthAccount.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException("Akun tersambung tidak ditemukan.");
    return account;
  }

  /** Mulai izin: alamat halaman izin penyedia. `drive` = minta juga izin Drive (tahap 4), `loginHint` = akun yang sudah tersambung. */
  start(userId: string, provider: OAuthProvider, options: { drive?: boolean; loginHint?: string } = {}) {
    const client = this.client(provider);
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > STATE_TTL_MS) this.pending.delete(k);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    this.pending.set(state, { userId, provider, verifier, at: now, drive: !!options.drive });
    return {
      url: authorizeUrl(provider, this.endpoints(provider), {
        clientId: client.id,
        redirectUri: this.redirectUri,
        state,
        verifier,
        drive: options.drive,
        loginHint: options.loginHint,
      }),
    };
  }

  private async postForm(url: string, form: Record<string, string>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, body };
  }

  /** Callback penyedia → simpan akun. Mengembalikan alamat halaman Akasha tujuan. */
  async callback(query: { code?: string; state?: string; error?: string; error_description?: string }) {
    const back = (params: Record<string, string>) =>
      `${this.appUrl}/settings/accounts?${new URLSearchParams(params).toString()}`;
    const pending = query.state ? this.pending.get(query.state) : undefined;
    if (query.state) this.pending.delete(query.state);
    if (!pending || Date.now() - pending.at > STATE_TTL_MS)
      return back({ connect_error: "Sesi izin kedaluwarsa. Ulangi Sambungkan." });
    if (query.error || !query.code)
      return back({
        connect_error:
          query.error === "access_denied"
            ? "Izin dibatalkan."
            : (query.error_description ?? query.error ?? "Izin gagal.").slice(0, 200),
      });
    try {
      const client = this.client(pending.provider);
      const endpoints = this.endpoints(pending.provider);
      const res = await this.postForm(endpoints.token, {
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: this.redirectUri,
        client_id: client.id,
        client_secret: client.secret,
        code_verifier: pending.verifier,
      });
      const token = parseTokenResponse(res.body, Date.now());
      if (!token.refresh_token)
        throw new Error("Penyedia tidak memberi refresh token. Cabut izin Akasha di akun Anda lalu sambungkan ulang.");
      const profileRes = await fetch(endpoints.profile, {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(30_000),
      });
      const identity = profileIdentity(pending.provider, await profileRes.json().catch(() => ({})));
      const scopes = typeof res.body.scope === "string" ? res.body.scope : "";
      if (pending.drive && !hasDriveScope(pending.provider, scopes))
        throw new Error("Izin Drive tidak diberikan. Centang semua izin di halaman penyedia lalu ulangi.");
      await this.prisma.oAuthAccount.upsert({
        where: { userId_provider_email: { userId: pending.userId, provider: pending.provider, email: identity.email } },
        create: {
          userId: pending.userId,
          provider: pending.provider,
          email: identity.email,
          displayName: identity.displayName,
          scopes,
          tokenEnc: this.crypto.encrypt(JSON.stringify(token)),
        },
        update: {
          displayName: identity.displayName,
          scopes,
          tokenEnc: this.crypto.encrypt(JSON.stringify(token)),
          status: "ok",
          statusMessage: null,
        },
      });
      return back({ connected: pending.drive ? `${pending.provider}-drive` : pending.provider });
    } catch (error) {
      this.logger.warn(`Sambungkan ${pending.provider} gagal: ${String((error as Error).message ?? error)}`);
      return back({ connect_error: String((error as Error).message ?? error).slice(0, 200) });
    }
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    // Berkas arsip dingin hanya ada di Drive akun ini → kembalikan dulu ke Akasha (tahap 4)
    const cold = await this.prisma.coldObject.count({ where: { oauthAccountId: id } });
    if (cold)
      throw new ConflictException(
        `${cold} berkas arsip dingin masih tersimpan di Drive akun ini. Buka Arsip dingin → Kembalikan semua dulu.`,
      );
    // Kalender & akun email Outlook yang memakai akun ini ikut terhapus (cascade); kalender "Akasha" di penyedia dibiarkan
    await this.prisma.oAuthAccount.delete({ where: { id } });
    return { ok: true };
  }

  /** Token akses yang masih berlaku (diperbarui otomatis). Izin dicabut → status error + galat yang bisa dibaca user. */
  async accessToken(account: OAuthAccount): Promise<string> {
    const token = JSON.parse(this.crypto.decrypt(account.tokenEnc)) as StoredToken;
    if (!tokenExpired(token, Date.now())) return token.access_token;
    const running = this.refreshing.get(account.id);
    if (running) return running;
    const job = this.refresh(account, token).finally(() => this.refreshing.delete(account.id));
    this.refreshing.set(account.id, job);
    return job;
  }

  private async refresh(account: OAuthAccount, token: StoredToken) {
    const provider = account.provider as OAuthProvider;
    const client = this.client(provider);
    if (!token.refresh_token) throw new ProviderError("Akun perlu disambungkan ulang.");
    const res = await this.postForm(this.endpoints(provider).token, {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: client.id,
      client_secret: client.secret,
    });
    if (!res.ok) {
      const message = isRevoked(res.body)
        ? "Izin akun dicabut atau kedaluwarsa. Sambungkan ulang akun ini."
        : `Gagal memperbarui token: ${String(res.body.error_description ?? res.body.error ?? "galat penyedia").slice(0, 200)}`;
      await this.prisma.oAuthAccount.update({
        where: { id: account.id },
        data: { status: "error", statusMessage: message },
      });
      throw new ProviderError(message);
    }
    const next = parseTokenResponse(res.body, Date.now(), token);
    await this.prisma.oAuthAccount.update({
      where: { id: account.id },
      data: { tokenEnc: this.crypto.encrypt(JSON.stringify(next)), status: "ok", statusMessage: null },
    });
    return next.access_token;
  }

  /** Panggil API penyedia dengan token akun (JSON). Galat dipetakan ke ProviderError, 404/410 dikembalikan apa adanya. */
  async api<T = unknown>(
    account: OAuthAccount,
    url: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string>; allow?: number[] } = {},
  ): Promise<{ status: number; data: T }> {
    const token = await this.accessToken(account);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const data = ((): T => {
      try {
        return (text ? JSON.parse(text) : null) as T;
      } catch {
        return null as T;
      }
    })();
    if (!res.ok && !(init.allow ?? []).includes(res.status)) {
      const err = (data ?? {}) as { error?: { message?: string } | string; error_description?: string };
      const message = typeof err.error === "object" ? err.error?.message : (err.error_description ?? err.error);
      throw new ProviderError(
        `${account.provider === "google" ? "Google" : "Microsoft"}: ${String(message ?? res.status).slice(0, 200)}`,
      );
    }
    return { status: res.status, data };
  }
}
