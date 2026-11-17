import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createSafeFetch } from "../common/safe-fetch";
import { ConfigService } from "@nestjs/config";
import { AkaiCrypto } from "../common/crypto";
import { ApiFormat, type AiSource, Prisma, SourceKind } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  OFFICIAL_BASE,
  PRESET_DEFAULTS,
  type RouterPreset,
  keyHint,
  normalizeBaseUrl,
  parseCatalog,
} from "./source-logic";
import { type AiTask, type RoutableModel, AI_TASKS, TASK_LABELS, taskModelsProblem } from "./task-logic";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

export interface SourceInput {
  kind: SourceKind;
  preset?: RouterPreset;
  label?: string;
  baseUrl?: string;
  apiFormat?: ApiFormat;
  apiKey: string;
}

export interface ModelInput {
  label?: string;
  contextLength?: number | null;
  priceIn?: number | null;
  priceOut?: number | null;
  currency?: string | null;
  packaged?: boolean;
  vision?: boolean;
  pdf?: boolean;
  tools?: boolean;
  embedding?: boolean;
  audio?: boolean;
  enabled?: boolean;
}

const OFFICIAL_LABEL: Record<Exclude<SourceKind, "router">, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
};

/** Sumber model, katalog, model yang dinyalakan, dan pembagian tugas milik satu akun (docs/AKAI.md §3–§4). */
@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  private readonly crypto: AkaiCrypto;
  private readonly production: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.crypto = new AkaiCrypto(config.getOrThrow<string>("AKAI_ENCRYPTION_KEY"));
    this.production = config.get<string>("NODE_ENV") === "production";
    this.outbound = createSafeFetch(!this.production);
  }

  /** fetch keluar ke sumber model (router milik pengguna): IP jaringan lokal ditolak di production (anti-SSRF). */
  readonly outbound: typeof fetch;

  private view(source: AiSource) {
    const { keyEnc: _keyEnc, accountId: _accountId, ...rest } = source;
    void _keyEnc;
    void _accountId;
    return rest;
  }

  async list(accountId: string) {
    const rows = await this.prisma.aiSource.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => this.view(row));
  }

  private async own(accountId: string, id: string) {
    const source = await this.prisma.aiSource.findFirst({ where: { id, accountId } });
    if (!source) throw new NotFoundException("Sumber model tidak ditemukan.");
    return source;
  }

  /** Alamat & format akhir: provider resmi = alamat resmi; router = preset atau isian (divalidasi SSRF). */
  private endpoint(input: { kind: SourceKind; preset?: RouterPreset; baseUrl?: string; apiFormat?: ApiFormat }) {
    if (input.kind !== SourceKind.router)
      return {
        baseUrl: null,
        apiFormat: input.kind === SourceKind.anthropic ? ApiFormat.anthropic : ApiFormat.openai,
      };
    const preset = input.preset ?? "custom";
    const raw = input.baseUrl ?? PRESET_DEFAULTS[preset].baseUrl;
    if (!raw) throw new BadRequestException("Alamat API router wajib diisi.");
    const url = normalizeBaseUrl(raw, this.production);
    if (!url.ok) throw new BadRequestException(url.error);
    return { baseUrl: url.url, apiFormat: input.apiFormat ?? (PRESET_DEFAULTS[preset].format as ApiFormat) };
  }

  async create(accountId: string, input: SourceInput) {
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8) throw new BadRequestException("API key terlalu pendek.");
    const { baseUrl, apiFormat } = this.endpoint(input);
    const label =
      input.label?.trim() ||
      (input.kind === SourceKind.router ? PRESET_DEFAULTS[input.preset ?? "custom"].label : OFFICIAL_LABEL[input.kind]);
    const source = await this.prisma.aiSource.create({
      data: {
        accountId,
        kind: input.kind,
        preset: input.kind === SourceKind.router ? (input.preset ?? "custom") : null,
        label: label.slice(0, 80),
        baseUrl,
        apiFormat,
        keyEnc: this.crypto.encrypt(apiKey),
        keyHint: keyHint(apiKey),
      },
    });
    return this.view(source);
  }

  /** Ubah label / alamat / format / key. Alamat atau format berubah → key wajib diisi ulang (key lama tidak dikirim ke alamat lain). */
  async update(
    accountId: string,
    id: string,
    input: { label?: string; baseUrl?: string; apiFormat?: ApiFormat; apiKey?: string },
  ) {
    const source = await this.own(accountId, id);
    const data: Prisma.AiSourceUpdateInput = {};
    if (input.label !== undefined) data.label = input.label.trim().slice(0, 80) || source.label;
    if (source.kind === SourceKind.router && (input.baseUrl !== undefined || input.apiFormat !== undefined)) {
      const next = this.endpoint({
        kind: source.kind,
        preset: (source.preset ?? "custom") as RouterPreset,
        baseUrl: input.baseUrl ?? source.baseUrl ?? undefined,
        apiFormat: input.apiFormat ?? source.apiFormat,
      });
      const moved = next.baseUrl !== source.baseUrl || next.apiFormat !== source.apiFormat;
      if (moved && !input.apiKey?.trim())
        throw new BadRequestException("Alamat atau format berubah: isi ulang API key untuk alamat baru.");
      data.baseUrl = next.baseUrl;
      data.apiFormat = next.apiFormat;
    }
    if (input.apiKey !== undefined) {
      const apiKey = input.apiKey.trim();
      if (apiKey.length < 8) throw new BadRequestException("API key terlalu pendek.");
      data.keyEnc = this.crypto.encrypt(apiKey);
      data.keyHint = keyHint(apiKey);
      data.lastStatus = null;
      data.lastError = null;
    }
    return this.view(await this.prisma.aiSource.update({ where: { id }, data }));
  }

  /**
   * Salin sumber router dengan format API lain (alamat & key sama; key terenkripsi disalin di server, tidak pernah lewat
   * browser). Dipakai agar satu router bisa dipanggil dua format: Claude lewat Anthropic Messages (prompt caching, pemikiran,
   * PDF) dan model lain lewat OpenAI Chat Completions — tanpa menempel ulang key.
   */
  async clone(accountId: string, id: string, input: { apiFormat: ApiFormat; label?: string }) {
    const source = await this.own(accountId, id);
    if (source.kind !== SourceKind.router) throw new BadRequestException("Hanya sumber router yang bisa disalin.");
    if (source.apiFormat === input.apiFormat)
      throw new BadRequestException("Format sama dengan sumber asal — pilih format lain.");
    const duplicate = await this.prisma.aiSource.findFirst({
      where: { accountId, kind: SourceKind.router, baseUrl: source.baseUrl, apiFormat: input.apiFormat },
    });
    if (duplicate) throw new BadRequestException(`Sumber "${duplicate.label}" sudah memakai alamat & format ini.`);
    const suffix = input.apiFormat === ApiFormat.anthropic ? "Anthropic" : "OpenAI";
    const copy = await this.prisma.aiSource.create({
      data: {
        accountId,
        kind: source.kind,
        preset: source.preset,
        label: (input.label?.trim() || `${source.label} (${suffix})`).slice(0, 80),
        baseUrl: source.baseUrl,
        apiFormat: input.apiFormat,
        keyEnc: source.keyEnc,
        keyHint: source.keyHint,
      },
    });
    return this.view(copy);
  }

  async remove(accountId: string, id: string) {
    await this.own(accountId, id);
    await this.prisma.aiSource.delete({ where: { id } });
    await this.pruneRoutes(accountId);
  }

  /** Alamat, format, dan key terbuka sumber — hanya untuk memanggil model di server (tidak pernah dikirim ke klien). */
  endpointOf(source: AiSource): { baseUrl: string; format: ApiFormat; apiKey: string } {
    return {
      baseUrl: source.kind === SourceKind.router ? source.baseUrl! : OFFICIAL_BASE[source.kind],
      format: source.apiFormat,
      apiKey: this.crypto.decrypt(source.keyEnc),
    };
  }

  /** `GET {alamat}/models` dengan key sumber (uji koneksi & katalog). Galat → pesan ramah, tidak pernah key/isi mentah. */
  private async fetchModels(source: AiSource): Promise<unknown> {
    const apiKey = this.crypto.decrypt(source.keyEnc);
    const base = source.kind === SourceKind.router ? source.baseUrl! : OFFICIAL_BASE[source.kind];
    const anthropic = source.apiFormat === ApiFormat.anthropic;
    const headers: Record<string, string> = anthropic
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${apiKey}` };
    let res: Response;
    try {
      res = await this.outbound(`${base}/models`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      this.logger.warn(`Katalog ${source.id} gagal dihubungi: ${String(error)}`);
      throw new BadRequestException("Alamat API tidak dapat dihubungi.");
    }
    if (res.status === 401 || res.status === 403) throw new BadRequestException("API key ditolak sumber model.");
    if (!res.ok) throw new BadRequestException(`Sumber model menjawab galat ${res.status}.`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_CATALOG_BYTES) throw new BadRequestException("Daftar model terlalu besar.");
    const text = await res.text();
    if (text.length > MAX_CATALOG_BYTES) throw new BadRequestException("Daftar model terlalu besar.");
    try {
      return JSON.parse(text);
    } catch {
      throw new BadRequestException("Jawaban daftar model bukan JSON.");
    }
  }

  /** Uji koneksi: daftar model bisa dibaca dengan key ini. */
  async test(accountId: string, id: string) {
    const source = await this.own(accountId, id);
    try {
      const count = parseCatalog(await this.fetchModels(source)).length;
      await this.prisma.aiSource.update({
        where: { id },
        data: { lastStatus: "ok", lastError: null, testedAt: new Date() },
      });
      return { ok: true, models: count };
    } catch (error) {
      const message = error instanceof BadRequestException ? error.message : "Uji koneksi gagal.";
      await this.prisma.aiSource.update({
        where: { id },
        data: { lastStatus: "error", lastError: message, testedAt: new Date() },
      });
      return { ok: false, error: message };
    }
  }

  /** Muat ulang katalog dari `GET /models` (menggantikan salinan lama). */
  async refreshCatalog(accountId: string, id: string) {
    const source = await this.own(accountId, id);
    const entries = parseCatalog(await this.fetchModels(source)).slice(0, 2000);
    await this.prisma.$transaction([
      this.prisma.aiCatalogEntry.deleteMany({ where: { sourceId: id } }),
      this.prisma.aiCatalogEntry.createMany({ data: entries.map((e) => ({ ...e, sourceId: id })) }),
      this.prisma.aiSource.update({
        where: { id },
        data: { catalogAt: new Date(), lastStatus: "ok", lastError: null, testedAt: new Date() },
      }),
    ]);
    return { count: entries.length };
  }

  async catalog(accountId: string, id: string) {
    await this.own(accountId, id);
    return this.prisma.aiCatalogEntry.findMany({ where: { sourceId: id }, orderBy: { modelId: "asc" } });
  }

  // ---------------------------------------------------------------- model yang dinyalakan

  listModels(accountId: string) {
    return this.prisma.aiModel.findMany({
      where: { accountId },
      include: { source: { select: { label: true, kind: true } } },
      orderBy: [{ enabled: "desc" }, { label: "asc" }],
    });
  }

  /** Nyalakan model dari katalog (atau id model isian sendiri); kemampuan & harga awal dari katalog bila ada. */
  async addModel(accountId: string, sourceId: string, modelId: string, input: ModelInput) {
    const source = await this.own(accountId, sourceId);
    const id = modelId.trim();
    if (!id || id.length > 200) throw new BadRequestException("ID model tidak valid.");
    const entry = await this.prisma.aiCatalogEntry.findUnique({
      where: { sourceId_modelId: { sourceId, modelId: id } },
    });
    const exists = await this.prisma.aiModel.findUnique({ where: { sourceId_modelId: { sourceId, modelId: id } } });
    if (exists) throw new BadRequestException("Model ini sudah dinyalakan.");
    return this.prisma.aiModel.create({
      data: {
        accountId,
        sourceId: source.id,
        modelId: id,
        label: (input.label?.trim() || entry?.name || id).slice(0, 120),
        contextLength: input.contextLength ?? entry?.contextLength ?? null,
        priceIn: input.priceIn ?? entry?.priceIn ?? null,
        priceOut: input.priceOut ?? entry?.priceOut ?? null,
        currency: input.currency ?? entry?.currency ?? null,
        packaged: input.packaged ?? false,
        vision: input.vision ?? entry?.vision ?? false,
        pdf: input.pdf ?? false,
        tools: input.tools ?? entry?.tools ?? false,
        embedding: input.embedding ?? entry?.embedding ?? false,
        audio: input.audio ?? false,
        enabled: input.enabled ?? true,
      },
    });
  }

  async updateModel(accountId: string, id: string, input: ModelInput) {
    const model = await this.prisma.aiModel.findFirst({ where: { id, accountId } });
    if (!model) throw new NotFoundException("Model tidak ditemukan.");
    const updated = await this.prisma.aiModel.update({
      where: { id },
      data: { ...input, label: input.label?.trim().slice(0, 120) || undefined },
    });
    if (input.enabled === false || input.embedding !== undefined || input.vision !== undefined)
      await this.pruneRoutes(accountId);
    return updated;
  }

  async removeModel(accountId: string, id: string) {
    const model = await this.prisma.aiModel.findFirst({ where: { id, accountId } });
    if (!model) throw new NotFoundException("Model tidak ditemukan.");
    await this.prisma.aiModel.delete({ where: { id } });
    await this.pruneRoutes(accountId);
  }

  // ---------------------------------------------------------------- pembagian tugas

  private async routableModels(accountId: string) {
    const rows = await this.prisma.aiModel.findMany({
      where: { accountId },
      include: { source: { select: { kind: true } } },
    });
    return new Map<string, RoutableModel>(
      rows.map((m) => [
        m.id,
        {
          id: m.id,
          enabled: m.enabled,
          vision: m.vision,
          embedding: m.embedding,
          audio: m.audio,
          sourceKind: m.source.kind,
        },
      ]),
    );
  }

  async tasks(accountId: string) {
    const rows = await this.prisma.aiTaskRoute.findMany({ where: { accountId } });
    const byTask = new Map(rows.map((r) => [r.task, r.modelIds as string[]]));
    return AI_TASKS.map((task) => ({ task, label: TASK_LABELS[task], modelIds: byTask.get(task) ?? [] }));
  }

  async setTask(accountId: string, task: AiTask, modelIds: string[]) {
    const problem = taskModelsProblem(task, modelIds, await this.routableModels(accountId));
    if (problem) throw new BadRequestException(problem);
    await this.prisma.aiTaskRoute.upsert({
      where: { accountId_task: { accountId, task } },
      create: { accountId, task, modelIds },
      update: { modelIds },
    });
    return { task, label: TASK_LABELS[task], modelIds };
  }

  /** Buang model yang dihapus / dimatikan / tidak lagi cocok dari pembagian tugas. */
  private async pruneRoutes(accountId: string) {
    const models = await this.routableModels(accountId);
    const rows = await this.prisma.aiTaskRoute.findMany({ where: { accountId } });
    for (const row of rows) {
      const ids = (row.modelIds as string[]).filter((id) => !taskModelsProblem(row.task as AiTask, [id], models));
      if (ids.length !== (row.modelIds as string[]).length)
        await this.prisma.aiTaskRoute.update({ where: { id: row.id }, data: { modelIds: ids } });
    }
  }
}
