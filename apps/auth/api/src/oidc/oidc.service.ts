import { randomBytes } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Provider, { type Configuration, interactionPolicy, type KoaContextWithOIDC } from "oidc-provider";
import { SESSION_COOKIE, hashToken } from "../common/http";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { createOidcAdapter } from "./oidc-adapter";
import { appClaims, parseClients, parseJwks } from "./oidc-config";
import { logoutPage, errorPage } from "./oidc-pages";

const DAY = 24 * 60 * 60;
const SWEEP_MS = 60 * 60 * 1000;

/** Mesin OpenID Connect (oidc-provider). Dipasang di `/oidc` oleh main.ts. */
@Injectable()
export class OidcService implements OnModuleDestroy {
  private readonly logger = new Logger(OidcService.name);
  readonly provider: Provider;
  readonly issuer: string;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const production = config.get<string>("NODE_ENV") === "production";
    const publicUrl = config.getOrThrow<string>("PUBLIC_URL").replace(/\/+$/, "");
    const secure = config.get<boolean>("COOKIE_SECURE") ?? production;
    this.issuer = `${publicUrl}/oidc`;
    const clients = parseClients(config.getOrThrow<string>("OIDC_CLIENTS"), production);
    const trustedBackchannel = new Set(
      clients.flatMap((c) => (c.backchannel_logout_uri ? [new URL(c.backchannel_logout_uri).href] : [])),
    );

    // Sumber kebenaran sesi = cookie ws_sid (halaman SSO). Sesi oidc-provider hanya cermin: bila ws_sid sudah tidak
    // berlaku (keluar dari halaman akun, reset kata sandi, akun dinonaktifkan) atau milik akun lain, masuk diminta ulang.
    const policy = interactionPolicy.base();
    policy.get("login")!.checks.add(
      new interactionPolicy.Check("ws_session", "Sesi SSO sudah berakhir", async (ctx) => {
        const accountId = ctx.oidc.session?.accountId;
        const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
        if (!accountId || !token) return interactionPolicy.Check.REQUEST_PROMPT;
        const session = await prisma.authSession.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { account: { select: { disabled: true } } },
        });
        const valid =
          session && session.accountId === accountId && session.expiresAt > new Date() && !session.account.disabled;
        return valid ? interactionPolicy.Check.NO_NEED_TO_PROMPT : interactionPolicy.Check.REQUEST_PROMPT;
      }),
    );

    const configuration: Configuration = {
      adapter: createOidcAdapter(prisma),
      clients: clients.map((c) => ({
        ...c,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        // Aplikasi dengan alamat back-channel menerima logout token (+ sid) saat sesi SSO berakhir
        ...(c.backchannel_logout_uri ? { backchannel_logout_session_required: true } : {}),
      })),
      jwks: parseJwks(config.getOrThrow<string>("OIDC_JWKS")) as Configuration["jwks"],
      // Proteksi SSRF bawaan menolak alamat privat/loopback. Alamat back-channel logout klien = aplikasi sendiri dari env
      // operator (jaringan internal Docker / localhost dev), jadi hanya alamat itu yang dikecualikan; selain itu tetap dilindungi.
      fetch: (url, options) => {
        const target = String(url);
        if (trustedBackchannel.has(target)) {
          const rest: RequestInit & { dispatcher?: unknown } = { ...options };
          delete rest.dispatcher;
          return globalThis.fetch(target, rest);
        }
        return globalThis.fetch(url, options);
      },
      cookies: {
        keys: config
          .getOrThrow<string>("OIDC_COOKIE_KEYS")
          .split(",")
          .map((k) => k.trim()),
        long: { signed: true, secure, sameSite: "lax" },
        short: { signed: true, secure, sameSite: "lax" },
      },
      pkce: { required: () => true },
      scopes: ["openid", "offline_access", "email", "profile", "phone", "address", "apps"],
      claims: {
        openid: ["sub"],
        email: ["email", "email_verified"],
        // occupation & workplace = klaim tambahan Workingspace (pekerjaan, tempat bekerja)
        profile: ["name", "occupation", "workplace"],
        phone: ["phone_number"],
        address: ["address"],
        apps: ["apps", "super_admin"],
      },
      // Klaim profil ikut di id_token agar aplikasi tidak perlu memanggil userinfo saat masuk
      conformIdTokenClaims: false,
      findAccount: async (_ctx, sub) => {
        const account = await prisma.account.findUnique({ where: { id: sub }, include: { memberships: true } });
        if (!account || account.disabled) return undefined;
        return {
          accountId: account.id,
          claims: () => ({
            sub: account.id,
            email: account.email,
            email_verified: !!account.emailVerifiedAt,
            name: account.name,
            occupation: account.occupation ?? undefined,
            workplace: account.workplace ?? undefined,
            phone_number: account.phone ?? undefined,
            address: account.address ? { formatted: account.address } : undefined,
            apps: appClaims(account.memberships),
            super_admin: account.superAdmin,
          }),
        };
      },
      // ws_silent=1: pemeriksaan sesi diam-diam dari aplikasi (InteractionController.start)
      extraParams: ["ws_silent"],
      interactions: { policy, url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
      // Semua klien = aplikasi ekosistem sendiri (first-party) → tanpa layar persetujuan; grant dibuat otomatis
      loadExistingGrant: async (ctx: KoaContextWithOIDC) => {
        const session = ctx.oidc.session;
        const client = ctx.oidc.client;
        if (!session?.accountId || !client) return undefined;
        const grantId = session.grantIdFor(client.clientId);
        if (grantId) {
          const existing = await ctx.oidc.provider.Grant.find(grantId);
          if (existing) return existing;
        }
        const grant = new ctx.oidc.provider.Grant({ clientId: client.clientId, accountId: session.accountId });
        grant.addOIDCScope("openid email profile apps offline_access");
        await grant.save();
        session.grantIdFor(client.clientId, grant.jti);
        return grant;
      },
      issueRefreshToken: async (_ctx, client, code) =>
        client.grantTypeAllowed("refresh_token") && code.scopes.has("offline_access"),
      features: {
        devInteractions: { enabled: false },
        revocation: { enabled: true },
        backchannelLogout: { enabled: true },
        rpInitiatedLogout: {
          enabled: true,
          // Diminta aplikasi terdaftar (client_id sah; post_logout_redirect_uri sudah divalidasi oidc-provider) → langsung keluar
          // tanpa konfirmasi. Tanpa klien (alamat dibuka langsung) → tetap konfirmasi.
          logoutSource: (ctx, form) => {
            if (!ctx.oidc.client) {
              ctx.body = logoutPage(form);
              return;
            }
            const nonce = randomBytes(16).toString("base64");
            ctx.set(
              "Content-Security-Policy",
              `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
            );
            ctx.body = logoutPage(form, undefined, nonce);
          },
          postLogoutSuccessSource: (ctx) => {
            ctx.body = logoutPage(null, publicUrl);
          },
        },
      },
      ttl: {
        AccessToken: 10 * 60,
        AuthorizationCode: 60,
        IdToken: 60 * 60,
        Interaction: 60 * 60,
        Session: 14 * DAY,
        Grant: 30 * DAY,
        RefreshToken: 30 * DAY,
      },
      renderError: (ctx, out) => {
        ctx.type = "html";
        ctx.body = errorPage(String(out.error_description ?? out.error), publicUrl);
      },
    };

    this.provider = new Provider(this.issuer, configuration);
    // Di belakang Caddy / proxy Vite: protokol & host dari X-Forwarded-*
    this.provider.proxy = true;
    this.provider.on("server_error", (_ctx, error) => this.logger.error(error));
    // Keluar dari aplikasi (RP-initiated logout) = keluar juga dari halaman SSO di browser ini
    this.provider.on("end_session.success", (ctx) => {
      const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
      ctx.cookies.set(SESSION_COOKIE, null, { path: "/", httpOnly: true, sameSite: "lax", secure, signed: false });
      if (token)
        prisma.authSession
          .deleteMany({ where: { tokenHash: hashToken(token) } })
          .catch((error) => this.logger.warn(`Hapus sesi SSO gagal: ${String(error)}`));
    });
    // Catat aplikasi yang dibuka dari sesi SSO ini (ws_sid) beserta sid OIDC-nya → dasar logout token saat sesi berakhir
    this.provider.on("authorization.success", (ctx: KoaContextWithOIDC) => {
      void this.linkAppSession(ctx).catch((error) => this.logger.warn(`Catat sesi aplikasi gagal: ${String(error)}`));
    });
    this.provider.on("backchannel.error", (_ctx, error, client) =>
      this.logger.warn(`Logout token ke ${client?.clientId} gagal: ${String(error)}`),
    );
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
  }

  private async linkAppSession(ctx: KoaContextWithOIDC) {
    const session = ctx.oidc.session;
    const client = ctx.oidc.client;
    const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
    if (!session?.accountId || !client?.backchannelLogoutUri || !token) return;
    const sid = session.sidFor(client.clientId);
    const authSession = await this.prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!sid || !authSession || authSession.accountId !== session.accountId) return;
    await this.prisma.appSessionLink.upsert({
      where: { authSessionId_clientId: { authSessionId: authSession.id, clientId: client.clientId } },
      create: { authSessionId: authSession.id, accountId: session.accountId, clientId: client.clientId, sid },
      update: { sid },
    });
  }

  /**
   * Kirim logout token ke aplikasi yang dibuka dari sesi SSO yang akan diakhiri (dipanggil SEBELUM sesinya dihapus;
   * baris tautan ikut terhapus bersama sesi). Galat pengiriman dicatat, tidak menggagalkan logout.
   */
  async notifyLogout(where: Prisma.AppSessionLinkWhereInput) {
    const links = await this.prisma.appSessionLink.findMany({ where });
    await Promise.allSettled(
      links.map(async (link) => {
        try {
          // backchannelLogout ada di Client oidc-provider (fitur backchannelLogout) tetapi tidak di deklarasi tipenya
          const client = (await this.provider.Client.find(link.clientId)) as
            | (Awaited<ReturnType<Provider["Client"]["find"]>> & {
                backchannelLogout(sub: string, sid: string): Promise<void>;
              })
            | undefined;
          if (client?.backchannelLogoutUri) await client.backchannelLogout(link.accountId, link.sid);
        } catch (error) {
          this.logger.warn(`Logout token ke ${link.clientId} gagal: ${String(error)}`);
        }
      }),
    );
  }

  /** Hapus baris oidc_payloads yang sudah kedaluwarsa. */
  private async sweep() {
    try {
      await this.prisma.oidcPayload.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (error) {
      this.logger.warn(`Sapuan oidc_payloads gagal: ${String(error)}`);
    }
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }
}
