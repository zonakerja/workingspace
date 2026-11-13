import { BadRequestException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { ExtractionQueueService } from "../extraction/extraction-queue.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { AiProviderError } from "../ai/providers/ai-client";
import { ConverterClient, ConverterRejectedError, ConverterUnavailableError } from "./converter-client";
import { buildEnhancePrompt } from "./markdown-enhance";
import { type EnhanceResult, MarkdownEnhancerService } from "./markdown-enhancer.service";
import {
  type ConverterMode,
  type ConverterPdfMode,
  type ConverterPrefs,
  converterHandles,
  needsReconvert,
  normalizeConverterPrefs,
  type ReconvertScope,
} from "./converter-logic";

/** Satu permintaan "konversi ulang" paling banyak mengantrekan berkas sebanyak ini. */
const MAX_RECONVERT = 2000;

/** Tools → Markdown Converter: status service, preferensi per user, coba konversi, konversi ulang berkas lama. */
@Injectable()
export class ConverterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ConverterClient,
    private readonly extractionQueue: ExtractionQueueService,
    private readonly enhancer: MarkdownEnhancerService,
    private readonly ai: AiService,
  ) {}

  async status() {
    const health = await this.client.health();
    return {
      configured: this.client.configured,
      reachable: !!health,
      ready: health?.ready ?? false,
      engines: health?.engines ?? {},
      ocrLanguages: health?.ocrLanguages ?? [],
      maxMb: Math.min(this.client.maxBytes / 1024 / 1024, health?.maxMb ?? Infinity),
      doclingMaxPages: health?.doclingMaxPages ?? null,
    };
  }

  async getPrefs(userId: string): Promise<ConverterPrefs> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { converterPrefs: true } });
    return normalizeConverterPrefs(user.converterPrefs);
  }

  async setPrefs(userId: string, patch: Partial<ConverterPrefs>) {
    const prefs = normalizeConverterPrefs({ ...(await this.getPrefs(userId)), ...patch });
    await this.prisma.user.update({ where: { id: userId }, data: { converterPrefs: { ...prefs } } });
    return prefs;
  }

  /** Coba konversi satu berkas (tidak disimpan). */
  async convert(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    options: { mode?: ConverterMode; pdfMode?: ConverterPdfMode; enhance?: boolean; compareTokens?: boolean },
  ) {
    if (!this.client.configured) {
      throw new UnprocessableEntityException(
        "Markdown Converter belum diatur di server (CONVERTER_URL & CONVERTER_TOKEN).",
      );
    }
    if (file.size > this.client.maxBytes) {
      throw new BadRequestException(`Berkas maksimal ${this.client.maxBytes / 1024 / 1024} MB.`);
    }
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    const prefs = await this.getPrefs(userId);
    try {
      const result = await this.client.convert(file.buffer, name, file.mimetype, {
        mode: options.mode ?? "auto",
        pdfMode: options.pdfMode ?? prefs.pdfMode,
      });
      let enhanced: (Omit<EnhanceResult, "markdown"> & { markdown: string }) | null = null;
      let enhanceError: string | null = null;
      if (options.enhance && result.markdown.trim()) {
        try {
          enhanced = await this.enhancer.enhance(userId, result.markdown, { fileName: name, engine: result.engine });
        } catch (error) {
          enhanceError = error instanceof AiProviderError ? error.providerMessage : errorText(error);
        }
      }
      const tokens = options.compareTokens
        ? await this.compareTokens(userId, file, name, result.markdown, result.engine, enhanced)
        : null;
      return { ...result, fileName: name, size: file.size, enhanced, enhanceError, tokenComparison: tokens };
    } catch (error) {
      if (error instanceof ConverterUnavailableError) {
        throw new UnprocessableEntityException(
          "Service Markdown Converter tidak menyala. Jalankan: docker compose --profile converter up -d --wait converter",
        );
      }
      if (error instanceof ConverterRejectedError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  /**
   * Token menurut tokenizer Gemini (`countTokens`, tanpa biaya): berkas mentah (PDF/gambar seperti dikirim ke AI; format lain
   * tidak bisa dibaca AI langsung), Markdown converter, hasil rapikan, dan biaya rapikan (masukan + keluaran).
   */
  private async compareTokens(
    userId: string,
    file: { buffer: Buffer; mimetype: string },
    name: string,
    markdown: string,
    engine: string,
    enhanced: { markdown: string; parts: number } | null,
  ) {
    try {
      const mime =
        file.mimetype === "application/octet-stream" && /\.pdf$/i.test(name) ? "application/pdf" : file.mimetype;
      const aiReadable = mime === "application/pdf" || /^image\/(png|jpeg|webp)$/.test(mime);
      const count = (text: string, raw?: boolean) =>
        this.ai.countTokens(userId, text, raw ? { data: file.buffer, mimeType: mime, name } : undefined);
      const markdownCount = await count(markdown);
      if (!markdownCount) return { available: false as const, reason: "Butuh API key Gemini langsung (bukan router)." };
      const rawFile = aiReadable && file.buffer.length <= 20 * 1024 * 1024 ? await count("", true) : null;
      let enhanceTokens: { input: number; output: number; result: number } | null = null;
      if (enhanced) {
        const overhead = (await count(
          buildEnhancePrompt("", { fileName: name, engine, part: 1, parts: enhanced.parts }),
        ))!;
        const result = (await count(enhanced.markdown))!.tokens;
        enhanceTokens = { input: overhead.tokens * enhanced.parts + markdownCount.tokens, output: result, result };
      }
      return {
        available: true as const,
        model: markdownCount.model,
        rawFile: rawFile?.tokens ?? null,
        rawFileNote: aiReadable ? null : "Format ini tidak bisa dibaca AI langsung (harus diekstrak dulu).",
        markdown: markdownCount.tokens,
        enhance: enhanceTokens,
      };
    } catch (error) {
      return {
        available: false as const,
        reason: `Gagal menghitung token: ${error instanceof AiProviderError ? error.providerMessage : errorText(error)}`,
      };
    }
  }

  /** Jumlah berkas milik user per cara baca (`metadata.method`) — untuk kartu statistik. */
  async stats(userId: string) {
    const rows = await this.prisma.$queryRaw<{ method: string | null; status: string; count: bigint }[]>(Prisma.sql`
      SELECT e.metadata->>'method' AS method, e.status::text AS status, COUNT(*) AS count
      FROM asset_extractions e JOIN assets a ON a.id = e.asset_id
      WHERE a.user_id = ${userId}
      GROUP BY 1, 2`);
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      const count = Number(row.count);
      byStatus[row.status] = (byStatus[row.status] ?? 0) + count;
      if (row.method) byMethod[row.method] = (byMethod[row.method] ?? 0) + count;
    }
    const scopes: Record<ReconvertScope, number> = {
      ai_ocr: (await this.candidates(userId, "ai_ocr")).length,
      missing: (await this.candidates(userId, "missing")).length,
      legacy: (await this.candidates(userId, "legacy")).length,
      unenhanced: (await this.candidates(userId, "unenhanced")).length,
    };
    return { byMethod, byStatus, reconvert: scopes };
  }

  private async candidates(userId: string, scope: ReconvertScope) {
    const prefs = await this.getPrefs(userId);
    const assets = await this.prisma.asset.findMany({
      where: { userId },
      select: {
        id: true,
        mimeType: true,
        originalName: true,
        extraction: { select: { status: true, metadata: true } },
      },
    });
    return assets
      .filter((asset) => converterHandles(asset.mimeType, asset.originalName))
      .filter((asset) => {
        const extraction = asset.extraction;
        const metadata = extraction?.metadata as { method?: string; converter?: { enhance?: unknown } } | null;
        const method = metadata?.method ?? null;
        const enhanced = !!metadata?.converter?.enhance;
        return needsReconvert(
          extraction ? { status: extraction.status, method, enhanced } : null,
          scope,
          prefs.aiEnhanceScope,
        );
      })
      .map((asset) => asset.id);
  }

  /** Baca ulang berkas lama lewat converter. Teks lama tetap dipakai sampai hasil baru selesai ditulis worker. */
  async reconvert(userId: string, scope: ReconvertScope) {
    if (!(await this.client.health())) {
      throw new UnprocessableEntityException("Service Markdown Converter tidak menyala, konversi ulang ditunda.");
    }
    const prefs = await this.getPrefs(userId);
    if (!prefs.enabled) throw new BadRequestException("Nyalakan Markdown Converter dulu.");
    if (scope === "unenhanced" && !prefs.aiEnhance) throw new BadRequestException("Nyalakan Rapikan dengan AI dulu.");
    const ids = (await this.candidates(userId, scope)).slice(0, MAX_RECONVERT);
    // Status tidak diubah dulu: berkas tetap terbaca (teks lama) sampai worker mengambilnya dari antrian
    for (const id of ids) await this.extractionQueue.enqueue(id, { rerun: true });
    return { queued: ids.length };
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
