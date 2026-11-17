import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSafeFetch } from "../common/safe-fetch";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Caller } from "../common/caller";
import { AkaiCrypto } from "../common/crypto";
import type { Connector, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { keyHint, normalizeBaseUrl } from "../sources/source-logic";
import { type ConnectorTool, buildToolset, connectorSlug, summarizeTools, toolResultText } from "./connector-logic";
import type { PackageConnector } from "../plugins/plugin-logic";

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
  const code = (error as { code?: unknown })?.code;
  return code === 401 || code === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(String(error));
};

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

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.crypto = new AkaiCrypto(config.getOrThrow<string>("AKAI_ENCRYPTION_KEY"));
    this.production = config.get<string>("NODE_ENV") === "production";
    this.publicFetch = createSafeFetch(false);
    this.internalFetch = createSafeFetch(true);
    this.akashaUrl = config.get<string>("AKASHA_MCP_URL")?.replace(/\/+$/, "") ?? null;
  }

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Konektor hanya untuk Akai web.");
  }

  private view(row: Connector) {
    const { tokenEnc, accountId: _accountId, ...rest } = row;
    void _accountId;
    return {
      ...rest,
      url: row.kind === "akasha" ? this.akashaUrl : row.url,
      hasToken: !!tokenEnc,
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
    return { akashaAvailable: !!this.akashaUrl, connectors: rows.map((r) => this.view(r)) };
  }

  private cleanUrl(raw: string | undefined) {
    if (!raw?.trim()) throw new BadRequestException("Alamat server MCP wajib diisi.");
    const result = normalizeBaseUrl(raw, this.production);
    if (!result.ok) throw new BadRequestException(result.error.replace("Alamat API", "Alamat server MCP"));
    return result.url;
  }

  async create(caller: Caller, input: { kind: "akasha" | "custom"; name?: string; url?: string; token?: string }) {
    this.requireWeb(caller);
    const count = await this.prisma.connector.count({ where: { accountId: caller.account.id } });
    if (count >= MAX_CONNECTORS) throw new BadRequestException(`Maks. ${MAX_CONNECTORS} konektor.`);
    if (input.kind === "akasha" && !this.akashaUrl)
      throw new BadRequestException("Konektor Akasha belum diaktifkan di server (AKASHA_MCP_URL).");
    const name = (input.name?.trim() || (input.kind === "akasha" ? "Akasha" : "")).slice(0, 60);
    if (!name) throw new BadRequestException("Nama konektor wajib diisi.");
    const url = input.kind === "akasha" ? null : this.cleanUrl(input.url);
    const token = input.token?.trim();
    if (input.kind === "akasha" && !token)
      throw new BadRequestException("Isi token akses Akasha (Akasha → Pengaturan → Integrasi → Buat token).");
    // Slug unik per akun (awalan nama alat untuk model)
    const base = connectorSlug(name);
    let slug = base;
    for (let n = 2; await this.prisma.connector.findFirst({ where: { accountId: caller.account.id, slug } }); n++)
      slug = `${base.slice(0, 17)}_${n}`;
    const row = await this.prisma.connector.create({
      data: {
        accountId: caller.account.id,
        name,
        slug,
        kind: input.kind,
        url,
        tokenEnc: token ? this.crypto.encrypt(token) : null,
        tokenHint: token ? keyHint(token) : null,
      },
    });
    return this.view(await this.refreshRow(row));
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
    const base = connectorSlug(spec.name);
    let slug = base;
    for (let n = 2; await this.prisma.connector.findFirst({ where: { accountId, slug } }); n++)
      slug = `${base.slice(0, 17)}_${n}`;
    const needsToken = spec.auth === "token";
    const row = await this.prisma.connector.create({
      data: {
        accountId,
        pluginId,
        name: spec.name,
        slug,
        kind: spec.preset ? "akasha" : "custom",
        url,
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
    input: { name?: string; enabled?: boolean; allowWrite?: boolean; token?: string; url?: string },
  ) {
    const row = await this.own(caller, id);
    const data: Prisma.ConnectorUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim().slice(0, 60) || row.name;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.allowWrite !== undefined) data.allowWrite = input.allowWrite;
    if (input.url !== undefined && row.kind === "custom") {
      data.url = this.cleanUrl(input.url);
      // Alamat berganti = token lama tidak dikirim ke alamat lain
      if (data.url !== row.url && input.token === undefined) {
        data.tokenEnc = null;
        data.tokenHint = null;
      }
    }
    if (input.token !== undefined) {
      const token = input.token.trim();
      data.tokenEnc = token ? this.crypto.encrypt(token) : null;
      data.tokenHint = token ? keyHint(token) : null;
    }
    const updated = await this.prisma.connector.update({ where: { id }, data });
    const reconnect = input.token !== undefined || input.url !== undefined;
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
    return { url: new URL(url), token: row.tokenEnc ? this.crypto.decrypt(row.tokenEnc) : null };
  }

  /** Klien MCP tersambung: Streamable HTTP, cadangan SSE untuk server lama. Ditutup setelah `fn` selesai. */
  private async withClient<T>(row: Connector, fn: (client: Client) => Promise<T>, timeout: number) {
    const { url, token } = this.endpoint(row);
    const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
    const fetch = row.kind === "akasha" || !this.production ? this.internalFetch : this.publicFetch;
    let client = new Client({ name: "akai", version: "1.0.0" });
    try {
      await withTimeout(
        client.connect(new StreamableHTTPClientTransport(url, { requestInit, fetch })),
        CONNECT_TIMEOUT_MS,
        "Sambungan",
      );
    } catch (error) {
      if (isAuthError(error)) throw error;
      client = new Client({ name: "akai", version: "1.0.0" });
      await withTimeout(
        client.connect(new SSEClientTransport(url, { requestInit, fetch })),
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

  private async refreshRow(row: Connector) {
    const status = (status: string, message: string | null, extra: Prisma.ConnectorUpdateInput = {}) =>
      this.prisma.connector.update({
        where: { id: row.id },
        data: { status, statusMessage: message, checkedAt: new Date(), ...extra },
      });
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
      if (isAuthError(error)) return status("auth_required", "Token ditolak aplikasi. Ganti token.");
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Konektor ${row.slug} gagal: ${message}`);
      return status("error", `Tidak bisa tersambung: ${message}`.slice(0, 500));
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
          data: { status: "auth_required", statusMessage: "Token ditolak aplikasi. Ganti token." },
        });
      return {
        isError: true,
        text: `Alat gagal dijalankan: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
