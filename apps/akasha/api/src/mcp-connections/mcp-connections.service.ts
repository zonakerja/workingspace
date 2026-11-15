import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createHmac } from "node:crypto";
import { type McpConnection, Prisma } from "../generated/prisma/client";
import { AiCrypto } from "../ai/ai-crypto";
import { fileHostsFor } from "./app-file-logic";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import {
  agentToolDecision,
  agentToolList,
  authorizationExtras,
  findPreset,
  type McpAuthType,
  type McpToolSummary,
  MCP_PRESETS,
  normalizeMcpUrl,
  normalizeScope,
  oauthErrorMessage,
  summarizeTools,
  toolResultText,
  uniqueSlug,
} from "./mcp-connection-logic";

/** Batas waktu satu sambungan / pemanggilan alat ke server MCP luar. */
const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_TOOL_PAGES = 10;

type OAuthData = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string };

export interface McpConnectionInput {
  name?: string;
  url?: string;
  preset?: string | null;
  authType?: McpAuthType;
  token?: string;
  icon?: string | null;
  agentEnabled?: boolean;
  allowWrite?: boolean;
  /** OAuth client yang didaftarkan pemilik; string kosong = hapus (kembali ke pendaftaran otomatis) */
  oauthClientId?: string;
  oauthClientSecret?: string;
  /** Scope OAuth (dipisah spasi); string kosong = sesuai daftar server */
  oauthScope?: string;
  /** Alat bertanda Hapus yang diizinkan untuk agen (daftar lengkap, menggantikan yang lama) */
  agentTools?: string[];
}

/** Client OAuth yang didaftarkan pemilik (bukan hasil pendaftaran klien dinamis). */
type ManualClient = { client_id: string; client_secret?: string };

/** Ditolak server karena kredensial (OAuth: UnauthorizedError; token: HTTP 401/403 dari transport). */
const isAuthError = (error: unknown) =>
  error instanceof UnauthorizedError || [401, 403].includes((error as { code?: number } | null)?.code ?? 0);

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} melewati batas waktu.`)), ms)),
  ]);

/**
 * Penyimpan OAuth untuk SDK klien MCP: pendaftaran klien dinamis, PKCE, token & perpanjangannya disimpan terenkripsi di
 * baris koneksi. `authorizationUrl` diisi saat SDK meminta pengguna membuka halaman otorisasi.
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
      client_name: "LifeOS",
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
    if (!this.data.verifier) throw new Error("Sesi otorisasi tidak ditemukan. Ulangi Sambungkan.");
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
 * Koneksi ke server MCP aplikasi luar (Canva, Notion, GitHub, …). LifeOS = klien MCP: menyimpan kredensial terenkripsi,
 * menguji sambungan, menyimpan daftar alat, dan meneruskan pemanggilan alat (dari halaman atau dari agen lewat MCP
 * LifeOS) — kredensial tidak pernah sampai ke browser maupun agen.
 */
@Injectable()
export class McpConnectionsService {
  private readonly logger = new Logger(McpConnectionsService.name);
  private readonly crypto: AiCrypto;
  private readonly production: boolean;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const key = createHmac("sha256", Buffer.from(config.getOrThrow<string>("AI_ENCRYPTION_KEY"), "hex"))
      .update("lifeos:mcp-connection:v1")
      .digest("hex");
    this.crypto = new AiCrypto(key);
    this.production = config.get<string>("NODE_ENV") === "production";
    this.appUrl = (config.get<string>("CORS_ORIGIN") ?? "").split(",")[0].trim().replace(/\/$/, "");
  }

  /** Alamat http / host lokal hanya diterima di luar production (dipakai juga untuk usulan agen). */
  get isProduction() {
    return this.production;
  }

  presets() {
    return MCP_PRESETS;
  }

  /** Alamat callback OAuth = alamat aplikasi (proxy /api ke backend di dev & produksi). */
  private get redirectUrl() {
    return `${this.appUrl}/api/v1/mcp-connections/oauth/callback`;
  }

  private view(row: McpConnection) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      url: row.url,
      preset: row.preset,
      icon: row.icon,
      authType: row.authType as McpAuthType,
      hasToken: !!row.tokenEnc,
      authorized: row.authType === "oauth" ? !!row.oauthEnc && !!this.oauth(row).tokens : undefined,
      oauthClientId: row.oauthClientId,
      hasClientSecret: !!row.oauthClientSecretEnc,
      oauthScope: row.oauthScope,
      redirectUrl: this.redirectUrl,
      status: row.status,
      statusMessage: row.statusMessage,
      tools: row.tools as unknown as McpToolSummary[],
      agentEnabled: row.agentEnabled,
      allowWrite: row.allowWrite,
      agentTools: agentToolList(row.agentTools),
      fileHosts: this.fileHosts(row),
      lastCheckedAt: row.lastCheckedAt,
      createdAt: row.createdAt,
    };
  }

  private oauth(row: McpConnection): OAuthData {
    if (!row.oauthEnc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(row.oauthEnc)) as OAuthData;
    } catch {
      return {};
    }
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.mcpConnection.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.view(r));
  }

  private async own(user: AuthUser, idOrSlug: string) {
    const row = await this.prisma.mcpConnection.findFirst({
      where: { userId: user.id, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
    if (!row) throw new NotFoundException("Koneksi aplikasi tidak ditemukan.");
    return row;
  }

  async get(user: AuthUser, idOrSlug: string) {
    return this.view(await this.own(user, idOrSlug));
  }

  private validUrl(raw: string) {
    const result = normalizeMcpUrl(raw, this.production);
    if (!result.ok) throw new BadRequestException(result.error);
    return result.url;
  }

  async create(user: AuthUser, input: McpConnectionInput) {
    const preset = findPreset(input.preset);
    const name = (input.name ?? preset?.name ?? "").trim();
    if (!name) throw new BadRequestException("Nama aplikasi wajib diisi.");
    const url = this.validUrl(input.url ?? preset?.url ?? "");
    const authType = input.authType ?? preset?.authType ?? "none";
    const taken = (
      await this.prisma.mcpConnection.findMany({ where: { userId: user.id }, select: { slug: true } })
    ).map((r) => r.slug);
    // Layanan sekelompok (mis. Google) memakai OAuth client yang sama: diambil dari koneksi lain bila tidak diisi
    let clientId = input.oauthClientId?.trim() || null;
    let clientSecretEnc = input.oauthClientSecret?.trim() ? this.crypto.encrypt(input.oauthClientSecret.trim()) : null;
    if (!clientId && preset?.group) {
      const sibling = await this.prisma.mcpConnection.findFirst({
        where: {
          userId: user.id,
          preset: { in: MCP_PRESETS.filter((p) => p.group === preset.group).map((p) => p.key) },
          oauthClientId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
      });
      if (sibling) {
        clientId = sibling.oauthClientId;
        clientSecretEnc = sibling.oauthClientSecretEnc;
      }
    }
    const row = await this.prisma.mcpConnection.create({
      data: {
        userId: user.id,
        oauthClientId: authType === "oauth" ? (clientId?.slice(0, 500) ?? null) : null,
        oauthClientSecretEnc: authType === "oauth" ? clientSecretEnc : null,
        oauthScope: authType === "oauth" ? normalizeScope(input.oauthScope ?? preset?.scope) : null,
        name: name.slice(0, 80),
        slug: uniqueSlug(name, taken),
        url,
        preset: preset?.key ?? null,
        icon: input.icon ?? preset?.icon ?? "plug",
        authType,
        tokenEnc: authType === "token" && input.token?.trim() ? this.crypto.encrypt(input.token.trim()) : null,
      },
    });
    return this.view(row);
  }

  async update(user: AuthUser, id: string, input: McpConnectionInput) {
    const row = await this.own(user, id);
    const data: Prisma.McpConnectionUpdateInput = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequestException("Nama aplikasi wajib diisi.");
      data.name = input.name.trim().slice(0, 80);
    }
    if (input.icon !== undefined) data.icon = input.icon || "plug";
    if (input.agentEnabled !== undefined) data.agentEnabled = input.agentEnabled;
    if (input.allowWrite !== undefined) data.allowWrite = input.allowWrite;
    if (input.agentTools !== undefined) data.agentTools = agentToolList(input.agentTools);
    // Ganti alamat / cara masuk = kredensial lama tidak pernah dikirim ke alamat lain
    const urlChanged = input.url !== undefined && this.validUrl(input.url) !== row.url;
    if (urlChanged) data.url = this.validUrl(input.url!);
    if (input.authType !== undefined && input.authType !== row.authType) data.authType = input.authType;
    if (urlChanged || data.authType) {
      data.tokenEnc = null;
      data.oauthEnc = null;
      data.oauthState = null;
      data.status = "new";
      data.tools = [];
    }
    if (input.token !== undefined) data.tokenEnc = input.token.trim() ? this.crypto.encrypt(input.token.trim()) : null;
    // Client / scope OAuth berganti = izin lama tidak berlaku lagi (token terikat client & scope), masuk ulang
    let oauthChanged = false;
    if (input.oauthClientId !== undefined && (input.oauthClientId.trim() || null) !== row.oauthClientId) {
      data.oauthClientId = input.oauthClientId.trim().slice(0, 500) || null;
      if (!data.oauthClientId) data.oauthClientSecretEnc = null;
      oauthChanged = true;
    }
    if (input.oauthClientSecret !== undefined && input.oauthClientSecret.trim()) {
      data.oauthClientSecretEnc = this.crypto.encrypt(input.oauthClientSecret.trim());
      oauthChanged = true;
    }
    if (input.oauthScope !== undefined && normalizeScope(input.oauthScope) !== row.oauthScope) {
      data.oauthScope = normalizeScope(input.oauthScope);
      oauthChanged = true;
    }
    if (oauthChanged && !urlChanged && !data.authType) {
      data.oauthEnc = null;
      data.oauthState = null;
      data.status = "auth_required";
      data.statusMessage = "Pengaturan OAuth berubah. Tekan Sambungkan.";
    }
    return this.view(await this.prisma.mcpConnection.update({ where: { id: row.id }, data }));
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.own(user, id);
    await this.prisma.mcpConnection.delete({ where: { id: row.id } });
    return { success: true };
  }

  /** Domain tempat aplikasi ini menaruh berkas hasil yang boleh disimpan ke LifeOS (`save_app_file`). */
  fileHosts(row: Pick<McpConnection, "url" | "preset">) {
    return fileHostsFor(row.url, findPreset(row.preset)?.fileHosts);
  }

  private manualClient(row: McpConnection): ManualClient | undefined {
    if (!row.oauthClientId) return undefined;
    const secret = row.oauthClientSecretEnc ? this.crypto.decrypt(row.oauthClientSecretEnc) : undefined;
    return { client_id: row.oauthClientId, ...(secret ? { client_secret: secret } : {}) };
  }

  private provider(row: McpConnection, state?: string) {
    return new StoredOAuthProvider(
      this.oauth(row),
      this.redirectUrl,
      async (data) => {
        await this.prisma.mcpConnection.update({
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
  private async withClient<T>(row: McpConnection, fn: (client: Client) => Promise<T>, timeout = CONNECT_TIMEOUT_MS) {
    const url = new URL(row.url);
    const token = row.authType === "token" && row.tokenEnc ? this.crypto.decrypt(row.tokenEnc) : null;
    const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
    const authProvider = row.authType === "oauth" ? this.provider(row) : undefined;
    let client = new Client({ name: "lifeos", version: "1.0.0" });
    try {
      await withTimeout(
        client.connect(new StreamableHTTPClientTransport(url, { requestInit, authProvider })),
        CONNECT_TIMEOUT_MS,
        "Sambungan",
      );
    } catch (error) {
      if (isAuthError(error)) throw error;
      client = new Client({ name: "lifeos", version: "1.0.0" });
      await withTimeout(
        client.connect(new SSEClientTransport(url, { requestInit, authProvider })),
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

  private async setStatus(
    id: string,
    status: string,
    statusMessage: string | null,
    extra: Prisma.McpConnectionUpdateInput = {},
  ) {
    return this.prisma.mcpConnection.update({
      where: { id },
      data: { status, statusMessage, lastCheckedAt: new Date(), ...extra },
    });
  }

  /** Uji sambungan & ambil daftar alat terbaru. */
  async refresh(user: AuthUser, id: string) {
    const row = await this.own(user, id);
    return this.view(await this.refreshRow(row));
  }

  private async refreshRow(row: McpConnection) {
    if (row.authType === "token" && !row.tokenEnc)
      return this.setStatus(row.id, "auth_required", "Isi token akses dulu.");
    if (row.authType === "oauth" && !this.oauth(row).tokens)
      return this.setStatus(row.id, "auth_required", "Belum masuk. Tekan Sambungkan.");
    try {
      const tools = await this.withClient(row, async (client) => {
        const all: Parameters<typeof summarizeTools>[0] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
          const result = await client.listTools(cursor ? { cursor } : undefined);
          all.push(...result.tools);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        return summarizeTools(all);
      });
      return this.setStatus(row.id, "connected", null, { tools: tools as unknown as Prisma.InputJsonValue });
    } catch (error) {
      if (isAuthError(error))
        return this.setStatus(
          row.id,
          "auth_required",
          row.authType === "token"
            ? "Token ditolak aplikasi. Ganti token."
            : "Izin kedaluwarsa. Tekan Sambungkan lagi.",
        );
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Koneksi MCP ${row.slug} gagal: ${message}`);
      return this.setStatus(row.id, "error", `Tidak bisa tersambung: ${message}`.slice(0, 500));
    }
  }

  /**
   * Sambungkan: tanpa OAuth = uji langsung. OAuth = bila sudah punya token diuji dulu; bila belum/ditolak, mulai
   * otorisasi (pendaftaran klien dinamis + PKCE) dan kembalikan alamat halaman izin untuk dibuka pengguna.
   */
  async connect(user: AuthUser, id: string) {
    let row = await this.own(user, id);
    if (row.authType !== "oauth") return { connection: this.view(await this.refreshRow(row)) };
    if (this.oauth(row).tokens) {
      row = await this.refreshRow(row);
      if (row.status === "connected") return { connection: this.view(row) };
    }
    const state = randomBytes(24).toString("base64url");
    await this.prisma.mcpConnection.update({ where: { id: row.id }, data: { oauthState: state } });
    const provider = this.provider({ ...row, oauthState: state }, state);
    try {
      const result = await auth(provider, { serverUrl: row.url, scope: row.oauthScope ?? undefined });
      if (result === "AUTHORIZED") {
        const fresh = await this.prisma.mcpConnection.findUniqueOrThrow({ where: { id: row.id } });
        return { connection: this.view(await this.refreshRow(fresh)) };
      }
      if (!provider.authorizationUrl) throw new Error("Server tidak memberi halaman otorisasi.");
      await this.setStatus(row.id, "auth_required", "Menunggu izin di jendela otorisasi.");
      return { authorizationUrl: provider.authorizationUrl.toString() };
    } catch (error) {
      const message = oauthErrorMessage(error instanceof Error ? error.message : String(error));
      await this.setStatus(row.id, "error", `Otorisasi gagal dimulai: ${message}`.slice(0, 500));
      throw new UnprocessableEntityException(`Otorisasi gagal dimulai: ${message}`);
    }
  }

  /** Callback OAuth dari aplikasi luar (dibuka browser pengguna) → alamat halaman koneksi untuk dialihkan. */
  async oauthCallback(code: string | undefined, state: string | undefined, error?: string) {
    const fallback = `${this.appUrl}/mcp/apps`;
    if (!state) return `${fallback}?error=${encodeURIComponent("Callback tanpa state.")}`;
    const row = await this.prisma.mcpConnection.findUnique({ where: { oauthState: state } });
    if (!row) return `${fallback}?error=${encodeURIComponent("Sesi otorisasi tidak dikenal atau sudah dipakai.")}`;
    const page = `${this.appUrl}/mcp/apps/${row.slug}`;
    if (error || !code) {
      await this.setStatus(row.id, "auth_required", `Izin ditolak: ${error ?? "tanpa kode"}`, { oauthState: null });
      return `${page}?error=${encodeURIComponent(error ?? "Izin tidak diberikan.")}`;
    }
    try {
      await auth(this.provider(row, state), {
        serverUrl: row.url,
        authorizationCode: code,
        scope: row.oauthScope ?? undefined,
      });
      const fresh = await this.prisma.mcpConnection.update({ where: { id: row.id }, data: { oauthState: null } });
      const done = await this.refreshRow(fresh);
      return done.status === "connected"
        ? `${page}?connected=1`
        : `${page}?error=${encodeURIComponent(done.statusMessage ?? "")}`;
    } catch (err) {
      const message = oauthErrorMessage(err instanceof Error ? err.message : String(err));
      await this.setStatus(row.id, "error", `Otorisasi gagal: ${message}`.slice(0, 500), { oauthState: null });
      return `${page}?error=${encodeURIComponent(message)}`;
    }
  }

  /** Koneksi yang boleh dipakai agen (dan alatnya, ditandai boleh/tidak). */
  async agentCatalog(user: AuthUser) {
    const rows = await this.prisma.mcpConnection.findMany({
      where: { userId: user.id, agentEnabled: true, status: "connected" },
    });
    return rows.map((row) => ({
      connection: row.slug,
      name: row.name,
      tools: (row.tools as unknown as McpToolSummary[]).map((t) => ({
        name: t.name,
        description: t.description,
        ...(t.destructive ? { destructive: true } : t.readOnly ? {} : { writes: true }),
        allowed: agentToolDecision(row, t).ok,
      })),
    }));
  }

  /** Jalankan satu alat. `asAgent` = aturan izin agen berlaku (alat hapus tidak pernah; alat tulis bila diizinkan). */
  async callTool(user: AuthUser, idOrSlug: string, name: string, args: Record<string, unknown>, asAgent: boolean) {
    const row = await this.own(user, idOrSlug);
    const tool = (row.tools as unknown as McpToolSummary[]).find((t) => t.name === name);
    if (asAgent) {
      const decision = agentToolDecision(row, tool);
      if (!decision.ok) throw new BadRequestException(decision.reason);
    } else if (!tool) throw new BadRequestException("Alat tidak ada di koneksi ini (muat ulang daftar alat).");
    try {
      const result = await this.withClient(
        row,
        (client) => client.callTool({ name, arguments: args }),
        CALL_TIMEOUT_MS,
      );
      const content = (result as { content?: { type: string; text?: string }[] }).content;
      return { isError: !!(result as { isError?: boolean }).isError, text: toolResultText(content) };
    } catch (error) {
      if (isAuthError(error)) {
        await this.setStatus(row.id, "auth_required", "Izin kedaluwarsa. Tekan Sambungkan lagi.");
        throw new UnprocessableEntityException("Izin ke aplikasi kedaluwarsa. Pemilik perlu menyambungkan ulang.");
      }
      throw new UnprocessableEntityException(
        `Alat gagal dijalankan: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
