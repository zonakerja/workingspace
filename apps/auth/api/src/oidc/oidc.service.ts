import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Provider, { type Configuration, interactionPolicy, type KoaContextWithOIDC } from "oidc-provider";
import { SESSION_COOKIE, hashToken } from "../common/http";
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
      })),
      jwks: parseJwks(config.getOrThrow<string>("OIDC_JWKS")) as Configuration["jwks"],
      cookies: {
        keys: config
          .getOrThrow<string>("OIDC_COOKIE_KEYS")
          .split(",")
          .map((k) => k.trim()),
        long: { signed: true, secure, sameSite: "lax" },
        short: { signed: true, secure, sameSite: "lax" },
      },
      pkce: { required: () => true },
      scopes: ["openid", "offline_access", "email", "profile", "apps"],
      claims: {
        openid: ["sub"],
        email: ["email", "email_verified"],
        profile: ["name"],
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
            apps: appClaims(account.memberships),
            super_admin: account.superAdmin,
          }),
        };
      },
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
        rpInitiatedLogout: {
          enabled: true,
          logoutSource: (ctx, form) => {
            ctx.body = logoutPage(form);
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
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
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
