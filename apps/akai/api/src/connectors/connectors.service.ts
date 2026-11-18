import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { createSafeFetch } from "../common/safe-fetch";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Caller } from "../common/caller";
import { AkaiCrypto } from "../common/crypto";
import type { Connector, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { keyHint, normalizeBaseUrl } from "../sources/source-logic";
import { type ConnectorTool, buildToolset, connectorSlug, summarizeTools, toolResultText } from "./connector-logic";
import type { PackageConnector } from "../plugins/plugin-logic";
import {
  CATALOG,
  CATALOG_CATEGORIES,
  type ConnectorAuth,
  authorizationExtras,
  findCatalogEntry,
  normalizeScope,
  oauthErrorMessage,
} from "./connector-catalog";

const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 90_000;
const MAX_CONNECTORS = 20;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} melebihi ${Math.round(ms / 1000)} detik`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const isAuthError = (error: unknown) => {
  if (error instanceof UnauthorizedError) return true;
  const code = (error as { code?: unknown })?.code;
  return code === 401 || code === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(String(error));
};

type OAuthData = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string };
type ManualClient = { client_id: string; client_secret?: string };

export interface CreateConnectorInput {
  kind: "akasha" | "custom";
  preset?: string;
  name?: string;
  url?: string;
  authType?: ConnectorAuth;
  token?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
}

/**
 * Penyimpan OAuth untuk SDK klien MCP (6b.10): pendaftaran klien dinamis (atau client milik pemilik), PKCE, token & perpanjangannya
 * disimpan terenkripsi di baris konektor. `authorizationUrl` diisi saat SDK meminta pengguna membuka halaman izin.
 */
class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;

  constructor(
    private data: OAuthData,
    private readonly redirect: string,
    private readonly persist: (data: OAuthData) => Promise<void>,
    private readonly stateValue?: string,
    private readonly manualClient?: ManualClient,
    private readonly scope?: string,
  ) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Akai · workingspace.id",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  state() {
    return this.stateValue ?? "";
  }

  clientInformation() {
    return this.manualClient ?? this.data.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    if (this.manualClient) return;
    this.data = { ...this.data, client };
    await this.persist(this.data);
  }

  tokens() {
    return this.data.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.data = { ...this.data, tokens };
    await this.persist(this.data);
  }

  redirectToAuthorization(url: URL) {
    for (const [key, value] of Object.entries(authorizationExtras(url))) url.searchParams.set(key, value);
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(verifier: string) {
    this.data = { ...this.data, verifier };
    await this.persist(this.data);
  }

  codeVerifier() {
    if (!this.data.verifier) throw new Error("Sesi izin tidak ditemukan. Ulangi Sambungkan.");
    return this.data.verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") this.data = {};
    else if (scope === "client") this.data = { ...this.data, client: undefined };
    else if (scope === "tokens") this.data = { ...this.data, tokens: undefined };
    else if (scope === "verifier") this.data = { ...this.data, verifier: undefined };
    await this.persist(this.data);
  }
}

/**
 * Konektor MCP Akai (6b.5, docs/AKAI.md §8): Akai menjadi klien MCP ke aplikasi lain — Akasha (alamat dari env `AKASHA_MCP_URL`,
 * token akses pribadi `akasha_pat_…` dari Akasha → Pengaturan → Integrasi) atau server MCP mana pun (alamat + token opsional).
 * Alat dipakai model di chat (loop alat di ChatService) menurut izin per konektor. Token tidak pernah dikirim ke browser/model.
 */
@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly crypto: AkaiCrypto;
  private readonly production: boolean;
  /** fetch untuk alamat MCP isian pengguna (IP jaringan lokal ditolak) dan untuk alamat internal dari env server. */
  private readonly publicFetch: typeof fetch;
  private readonly internalFetch: typeof fetch;
  readonly akashaUrl: string | null;
  /** Alamat Akai web (proxy /api ke Akai API) — callback OAuth & halaman kembali */
  private readonly webUrl: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.crypto = new AkaiCrypto(config.getOrThrow<string>("AKAI_ENCRYPTION_KEY"));
    this.production = config.get<string>("NODE_ENV") === "production";
    this.publicFetch = createSafeFetch(false);
    this.internalFetch = createSafeFetch(true);
    this.akashaUrl = config.get<string>("AKASHA_MCP_URL")?.replace(/\/+$/, "") ?? null;
    const explicit = config.get<string>("AKAI_WEB_URL");
    const redirect = config.get<string>("SSO_REDIRECT_URI");
    this.webUrl = explicit ? explicit.replace(/\/+$/, "") : redirect ? new URL(redirect).origin : null;
  }

  /** Alamat callback OAuth yang didaftarkan di aplikasi luar (lewat proxy /api Akai web, sama di dev & produksi). */
  get redirectUrl() {
    return this.webUrl ? `${this.webUrl}/api/connectors/oauth/callback` : null;
  }

  catalog(caller: Caller) {
    this.requireWeb(caller);
    return { categories: CATALOG_CATEGORIES, entries: CATALOG, redirectUrl: this.redirectUrl };
  }

  private oauth(row: Connector): OAuthData {
    if (!row.oauthEnc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(row.oauthEnc)) as OAuthData;
    } catch {
      return {};
    }
  }

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Konektor hanya untuk Akai web.");
  }

  private view(row: Connector) {
    const {
      tokenEnc,
      accountId: _accountId,
      oauthEnc: _oauthEnc,
      oauthState: _oauthState,
      oauthClientSecretEnc,
      ...rest
    } = row;
    void _accountId;
    void _oauthEnc;
    void _oauthState;
    return {
      ...rest,
      url: row.kind === "akasha" ? this.akashaUrl : row.url,
      hasToken: !!tokenEnc,
      authorized: row.authType === "oauth" ? !!this.oauth(row).tokens : undefined,
      hasClientSecret: !!oauthClientSecretEnc,
      tools: (row.tools as unknown as ConnectorTool[]).map(({ inputSchema: _schema, ...t }) => {
        void _schema;
        return t;
      }),
    };
  }

  private async own(caller: Caller, id: string) {
    this.requireWeb(caller);
    const row = await this.prisma.connector.findFirst({ where: { id, accountId: caller.account.id } });
    if (!row) throw new NotFoundException("Konektor tidak ditemukan.");
    return row;
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const rows = await this.prisma.connector.findMany({
      where: { accountId: caller.account.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      akashaAvailable: !!this.akashaUrl,
      redirectUrl: this.redirectUrl,
      connectors: rows.map((r) => this.view(r)),
    };
  }

  private cleanUrl(raw: string | undefined) {
    if (!raw?.trim()) throw new BadRequestException("Alamat server MCP wajib diisi.");
    const result = normalizeBaseUrl(raw, this.production);
    if (!result.ok) throw new BadRequestException(result.error.replace("Alamat API", "Alamat server MCP"));
    return result.url;
  }

  private async uniqueSlug(accountId: string, name: string) {
    const base = connectorSlug(name);
    let slug = base;
    for (let n = 2; await this.prisma.connector.findFirst({ where: { accountId, slug } }); n++)
      slug = `${base.slice(0, 17)}_${n}`;
    return slug;
  }

  /**
   * Konektor baru: Akasha (token akses pribadi), aplikasi katalog, atau alamat sendiri. OAuth belum diuji saat dibuat (status
   * "Perlu izin") — pemilik menekan Sambungkan untuk membuka jendela izin aplikasi itu.
   */
  async create(caller: Caller, input: CreateConnectorInput) {
    this.requireWeb(caller);
    const accountId = caller.account.id;
    const count = await this.prisma.connector.count({ where: { accountId } });
    if (count >= MAX_CONNECTORS) throw new BadRequestException(`Maks. ${MAX_CONNECTORS} konektor.`);
    if (input.kind === "akasha") {
      if (!this.akashaUrl)
        throw new BadRequestException("Konektor Akasha belum diaktifkan di server (AKASHA_MCP_URL).");
      const token = input.token?.trim();
      if (!token)
        throw new BadRequestException("Isi token akses Akasha (Akasha → Pengaturan → Integrasi → Buat token).");
      const name = (input.name?.trim() || "Akasha").slice(0, 60);
      const row = await this.prisma.connector.create({
        data: {
          accountId,
          name,
          slug: await this.uniqueSlug(accountId, name),
          kind: "akasha",
          authType: "token",
          tokenEnc: this.crypto.encrypt(token),
          tokenHint: keyHint(token),
        },
      });
      return this.view(await this.refreshRow(row));
    }
    const entry = findCatalogEntry(input.preset);
    if (input.preset && !entry) throw new BadRequestException("Aplikasi katalog tidak dikenal.");
    const name = (input.name?.trim() || entry?.name || "").slice(0, 60);
    if (!name) throw new BadRequestException("Nama konektor wajib diisi.");
    const url = this.cleanUrl(input.url?.trim() || entry?.url);
    const token = input.token?.trim();
    const authType: ConnectorAuth = input.authType ?? entry?.auth ?? (token ? "token" : "none");
    let clientId: string | null = null;
    let clientSecretEnc: string | null = null;
    if (authType === "oauth") {
      clientId = input.oauthClientId?.trim().slice(0, 500) || null;
      clientSecretEnc = input.oauthClientSecret?.trim() ? this.crypto.encrypt(input.oauthClientSecret.trim()) : null;
      // Layanan sekelompok (semua Google) memakai OAuth client yang sama: diambil dari konektor lain bila tidak diisi
      if (!clientId && entry?.group) {
        const sibling = await this.prisma.connector.findFirst({
          where: {
            accountId,
            preset: { in: CATALOG.filter((e) => e.group === entry.group).map((e) => e.key) },
            oauthClientId: { not: null },
          },
          orderBy: { updatedAt: "desc" },
        });
        if (sibling) {
          clientId = sibling.oauthClientId;
          clientSecretEnc = sibling.oauthClientSecretEnc;
        }
      }
      if (entry?.needsClient && !clientId)
        throw new BadRequestException(
          `${entry.name} tidak mendukung pendaftaran otomatis: isi Client ID (dan Secret) dari OAuth client Anda.`,
        );
    }
    const waitingAuth = authType === "oauth" || (authType === "token" && !token);
    const row = await this.prisma.connector.create({
      data: {
        accountId,
        name,
        slug: await this.uniqueSlug(accountId, name),
        kind: "custom",
        preset: entry?.key ?? null,
        url,
        authType,
        tokenEnc: authType === "token" && token ? this.crypto.encrypt(token) : null,
        tokenHint: authType === "token" && token ? keyHint(token) : null,
        oauthClientId: clientId,
        oauthClientSecretEnc: clientSecretEnc,
        oauthScope: authType === "oauth" ? normalizeScope(input.oauthScope ?? entry?.scope) : null,
        status: waitingAuth ? "auth_required" : "new",
        statusMessage:
          authType === "oauth" ? "Tekan Sambungkan untuk memberi izin." : waitingAuth ? "Isi token akses." : null,
      },
    });
    return this.view(waitingAuth ? row : await this.refreshRow(row));
  }

  /** Periksa konektor bawaan paket sebelum paket dipasang (alamat MCP sah, preset tersedia, kuota). */
  async checkPackageConnectors(accountId: string, specs: PackageConnector[], replacing = 0) {
    if (specs.some((c) => c.preset === "akasha") && !this.akashaUrl)
      throw new BadRequestException("Paket membutuhkan konektor Akasha, tetapi AKASHA_MCP_URL belum diatur di server.");
    for (const c of specs) if (!c.preset) this.cleanUrl(c.url ?? "");
    const count = await this.prisma.connector.count({ where: { accountId } });
    if (count - replacing + specs.length > MAX_CONNECTORS)
      throw new BadRequestException(
        `Paket membawa ${specs.length} konektor; maks. ${MAX_CONNECTORS} konektor per akun.`,
      );
  }

  /**
   * Konektor bawaan paket plugin (6b.7): dibuat tanpa token — pemilik mengisi token di halaman Konektor (tidak pernah dari berkas
   * paket). Ikut dimatikan / dihapus bersama paketnya (`plugin_id`, hapus berantai).
   */
  async createForPlugin(accountId: string, pluginId: string, spec: PackageConnector) {
    const url = spec.preset ? null : this.cleanUrl(spec.url ?? "");
    const slug = await this.uniqueSlug(accountId, spec.name);
    const needsToken = spec.auth === "token";
    const row = await this.prisma.connector.create({
      data: {
        accountId,
        pluginId,
        name: spec.name,
        slug,
        kind: spec.preset ? "akasha" : "custom",
        url,
        authType: spec.preset ? "token" : needsToken ? "token" : "none",
        allowWrite: spec.allowWrite,
        status: needsToken ? "auth_required" : "new",
        statusMessage: needsToken ? "Isi token akses di halaman Konektor agar alat paket ini bisa dipakai." : null,
      },
    });
    return needsToken ? row : this.refreshRow(row);
  }

  /** Nyalakan / matikan semua konektor bawaan satu paket. */
  async setPluginEnabled(pluginId: string, enabled: boolean) {
    await this.prisma.connector.updateMany({ where: { pluginId }, data: { enabled } });
  }

  /** Konektor bawaan paket (untuk halaman Plugin). */
  async forPlugin(accountId: string, pluginId: string) {
    const rows = await this.prisma.connector.findMany({
      where: { accountId, pluginId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      statusMessage: r.statusMessage,
      hasToken: !!r.tokenEnc,
      enabled: r.enabled,
      tools: (r.tools as unknown as ConnectorTool[]).length,
    }));
  }

  async update(
    caller: Caller,
    id: string,
    input: {
      name?: string;
      enabled?: boolean;
      allowWrite?: boolean;
      token?: string;
      url?: string;
      authType?: ConnectorAuth;
      oauthClientId?: string;
      oauthClientSecret?: string;
      oauthScope?: string;
    },
  ) {
    const row = await this.own(caller, id);
    const data: Prisma.ConnectorUpdateInput = {};
    let resetAuth = false;
    if (input.name !== undefined) data.name = input.name.trim().slice(0, 60) || row.name;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.allowWrite !== undefined) data.allowWrite = input.allowWrite;
    if (input.url !== undefined && row.kind === "custom") {
      data.url = this.cleanUrl(input.url);
      // Alamat berganti = token lama tidak dikirim ke alamat lain
      if (data.url !== row.url) resetAuth = true;
    }
    if (input.authType !== undefined && row.kind === "custom" && input.authType !== row.authType) {
      data.authType = input.authType;
      resetAuth = true;
    }
    // Alamat / cara masuk berganti = kredensial lama (token, izin OAuth) tidak pernah dikirim ke alamat lain
    if (resetAuth) {
      data.oauthEnc = null;
      data.oauthState = null;
      if (input.token === undefined) {
        data.tokenEnc = null;
        data.tokenHint = null;
      }
    }
    // Client / scope OAuth berganti = izin lama tidak berlaku (token terikat client & scope) → masuk ulang
    let oauthChanged = false;
    if (input.oauthClientId !== undefined && (input.oauthClientId.trim() || null) !== row.oauthClientId) {
      data.oauthClientId = input.oauthClientId.trim().slice(0, 500) || null;
      if (!data.oauthClientId) data.oauthClientSecretEnc = null;
      oauthChanged = true;
    }
    if (input.oauthClientSecret?.trim()) {
      data.oauthClientSecretEnc = this.crypto.encrypt(input.oauthClientSecret.trim());
      oauthChanged = true;
    }
    if (input.oauthScope !== undefined && normalizeScope(input.oauthScope) !== row.oauthScope) {
      data.oauthScope = normalizeScope(input.oauthScope);
      oauthChanged = true;
    }
    if (oauthChanged) {
      data.oauthEnc = null;
      data.oauthState = null;
    }
    const authType = (data.authType as ConnectorAuth | undefined) ?? (row.authType as ConnectorAuth);
    if ((resetAuth || oauthChanged) && authType === "oauth") {
      data.status = "auth_required";
      data.statusMessage = "Tekan Sambungkan untuk memberi izin.";
      data.tools = [];
    }
    if (input.token !== undefined) {
      const token = input.token.trim();
      data.tokenEnc = token ? this.crypto.encrypt(token) : null;
      data.tokenHint = token ? keyHint(token) : null;
    }
    const updated = await this.prisma.connector.update({ where: { id }, data });
    const reconnect = (input.token !== undefined || resetAuth) && authType !== "oauth";
    return this.view(reconnect ? await this.refreshRow(updated) : updated);
  }

  async remove(caller: Caller, id: string) {
    await this.own(caller, id);
    await this.prisma.connector.delete({ where: { id } });
  }

  async refresh(caller: Caller, id: string) {
    return this.view(await this.refreshRow(await this.own(caller, id)));
  }

  private endpoint(row: Connector) {
    const url = row.kind === "akasha" ? this.akashaUrl : row.url;
    if (!url) throw new UnprocessableEntityException("Alamat konektor tidak tersedia.");
    const token = row.authType !== "oauth" && row.tokenEnc ? this.crypto.decrypt(row.tokenEnc) : null;
    return { url: new URL(url), token };
  }

  private fetchFor(row: Connector) {
    return row.kind === "akasha" || !this.production ? this.internalFetch : this.publicFetch;
  }

  private manualClient(row: Connector): ManualClient | undefined {
    if (!row.oauthClientId) return undefined;
    const secret = row.oauthClientSecretEnc ? this.crypto.decrypt(row.oauthClientSecretEnc) : undefined;
    return { client_id: row.oauthClientId, ...(secret ? { client_secret: secret } : {}) };
  }

  private provider(row: Connector, state?: string) {
    if (!this.redirectUrl)
      throw new UnprocessableEntityException("Alamat Akai web belum diatur di server (AKAI_WEB_URL).");
    return new StoredOAuthProvider(
      this.oauth(row),
      this.redirectUrl,
      async (data) => {
        await this.prisma.connector.update({
          where: { id: row.id },
          data: { oauthEnc: this.crypto.encrypt(JSON.stringify(data)) },
        });
      },
      state,
      this.manualClient(row),
      row.oauthScope ?? undefined,
    );
  }

  /** Klien MCP tersambung: Streamable HTTP, cadangan SSE untuk server lama. Ditutup setelah `fn` selesai. */
  private async withClient<T>(row: Connector, fn: (client: Client) => Promise<T>, timeout: number) {
    const { url, token } = this.endpoint(row);
    const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
    const fetch = this.fetchFor(row);
    const authProvider = row.authType === "oauth" ? this.provider(row) : undefined;
    let client = new Client({ name: "akai", version: "1.0.0" });
    try {
      await withTimeout(
        client.connect(new StreamableHTTPClientTransport(url, { requestInit, fetch, authProvider })),
        CONNECT_TIMEOUT_MS,
        "Sambungan",
      );
    } catch (error) {
      if (isAuthError(error)) throw error;
      client = new Client({ name: "akai", version: "1.0.0" });
      await withTimeout(
        client.connect(new SSEClientTransport(url, { requestInit, fetch, authProvider })),
        CONNECT_TIMEOUT_MS,
        "Sambungan",
      ).catch((sseError: unknown) => {
        throw isAuthError(sseError) ? sseError : error;
      });
    }
    try {
      return await withTimeout(fn(client), timeout, "Permintaan");
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private authMessage(row: Connector) {
    return row.authType === "oauth"
      ? "Izin kedaluwarsa atau dicabut. Tekan Sambungkan lagi."
      : "Token ditolak aplikasi. Ganti token.";
  }

  private async refreshRow(row: Connector) {
    const status = (status: string, message: string | null, extra: Prisma.ConnectorUpdateInput = {}) =>
      this.prisma.connector.update({
        where: { id: row.id },
        data: { status, statusMessage: message, checkedAt: new Date(), ...extra },
      });
    if (row.authType === "oauth" && !this.oauth(row).tokens)
      return status("auth_required", "Tekan Sambungkan untuk memberi izin.");
    if (row.authType === "token" && !row.tokenEnc) return status("auth_required", "Isi token akses.");
    try {
      const tools = await this.withClient(
        row,
        async (client) => {
          const all: Parameters<typeof summarizeTools>[0] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 10; page++) {
            const result = await client.listTools(cursor ? { cursor } : undefined);
            all.push(...(result.tools as Parameters<typeof summarizeTools>[0]));
            cursor = result.nextCursor;
            if (!cursor) break;
          }
          return summarizeTools(all);
        },
        LIST_TIMEOUT_MS,
      );
      return status("connected", null, { tools: tools as unknown as Prisma.InputJsonValue });
    } catch (error) {
      if (isAuthError(error)) return status("auth_required", this.authMessage(row));
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Konektor ${row.slug} gagal: ${message}`);
      return status("error", `Tidak bisa tersambung: ${message}`.slice(0, 500));
    }
  }

  /**
   * Sambungkan: tanpa OAuth = uji langsung. OAuth = bila sudah punya izin diuji dulu; bila belum / kedaluwarsa, mulai otorisasi
   * (pendaftaran klien dinamis atau client milik pemilik + PKCE) dan kembalikan alamat halaman izin untuk dibuka browser.
   */
  async connect(caller: Caller, id: string) {
    let row = await this.own(caller, id);
    if (row.authType !== "oauth") return { connector: this.view(await this.refreshRow(row)) };
    if (this.oauth(row).tokens) {
      row = await this.refreshRow(row);
      if (row.status === "connected") return { connector: this.view(row) };
    }
    const state = randomBytes(24).toString("base64url");
    row = await this.prisma.connector.update({ where: { id: row.id }, data: { oauthState: state } });
    const provider = this.provider(row, state);
    try {
      const result = await auth(provider, {
        serverUrl: row.url!,
        scope: row.oauthScope ?? undefined,
        fetchFn: this.fetchFor(row),
      });
      if (result === "AUTHORIZED") {
        const fresh = await this.prisma.connector.findUniqueOrThrow({ where: { id: row.id } });
        return { connector: this.view(await this.refreshRow(fresh)) };
      }
      if (!provider.authorizationUrl) throw new Error("Aplikasi tidak memberi halaman izin.");
      await this.prisma.connector.update({
        where: { id: row.id },
        data: { status: "auth_required", statusMessage: "Menunggu izin di jendela aplikasi." },
      });
      return { authorizationUrl: provider.authorizationUrl.toString() };
    } catch (error) {
      const message = oauthErrorMessage(error instanceof Error ? error.message : String(error));
      await this.prisma.connector.update({
        where: { id: row.id },
        data: { status: "error", statusMessage: `Izin gagal dimulai: ${message}`.slice(0, 500), oauthState: null },
      });
      throw new UnprocessableEntityException(`Izin gagal dimulai: ${message}`);
    }
  }

  /** Callback OAuth (dibuka browser pengguna dari halaman izin aplikasi luar) → alamat halaman Konektor untuk dialihkan. */
  async oauthCallback(code: string | undefined, state: string | undefined, error?: string) {
    const page = `${this.webUrl ?? ""}/connectors`;
    const back = (params: Record<string, string>) => `${page}?${new URLSearchParams(params).toString()}`;
    if (!state) return back({ error: "Callback tanpa state." });
    const row = await this.prisma.connector.findUnique({ where: { oauthState: state } });
    if (!row) return back({ error: "Sesi izin tidak dikenal atau sudah dipakai. Ulangi Sambungkan." });
    if (error || !code) {
      await this.prisma.connector.update({
        where: { id: row.id },
        data: {
          status: "auth_required",
          statusMessage: `Izin tidak diberikan (${error ?? "tanpa kode"}).`,
          oauthState: null,
        },
      });
      return back({ error: `Izin ${row.name} tidak diberikan.`, id: row.id });
    }
    try {
      await auth(this.provider(row, state), {
        serverUrl: row.url!,
        authorizationCode: code,
        scope: row.oauthScope ?? undefined,
        fetchFn: this.fetchFor(row),
      });
      const fresh = await this.prisma.connector.update({ where: { id: row.id }, data: { oauthState: null } });
      const done = await this.refreshRow(fresh);
      return done.status === "connected"
        ? back({ connected: row.id })
        : back({ error: done.statusMessage ?? "Belum tersambung.", id: row.id });
    } catch (err) {
      const message = oauthErrorMessage(err instanceof Error ? err.message : String(err));
      await this.prisma.connector.update({
        where: { id: row.id },
        data: { status: "error", statusMessage: `Izin gagal: ${message}`.slice(0, 500), oauthState: null },
      });
      return back({ error: message, id: row.id });
    }
  }

  /** Alat yang boleh dipakai model untuk akun ini (konektor aktif & tersambung, menurut izin baca/ubah). */
  async toolset(accountId: string) {
    const rows = await this.prisma.connector.findMany({
      where: { accountId, enabled: true, status: "connected" },
      orderBy: { createdAt: "asc" },
    });
    return buildToolset(rows.map((r) => ({ ...r, tools: r.tools as unknown as ConnectorTool[] })));
  }

  /** Jalankan satu alat (dipanggil loop alat chat). Galat dikembalikan sebagai teks hasil agar model bisa menjelaskannya. */
  async call(accountId: string, connectorId: string, tool: string, args: Record<string, unknown>) {
    const row = await this.prisma.connector.findFirst({ where: { id: connectorId, accountId } });
    if (!row) return { isError: true, text: "Konektor tidak ditemukan." };
    try {
      const result = await this.withClient(
        row,
        (client) => client.callTool({ name: tool, arguments: args }),
        CALL_TIMEOUT_MS,
      );
      return {
        isError: !!(result as { isError?: boolean }).isError,
        text: toolResultText((result as { content?: unknown }).content) || "(alat tidak mengembalikan isi)",
      };
    } catch (error) {
      if (isAuthError(error))
        await this.prisma.connector.update({
          where: { id: row.id },
          data: { status: "auth_required", statusMessage: this.authMessage(row) },
        });
      return {
        isError: true,
        text: `Alat gagal dijalankan: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
