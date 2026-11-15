import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AssetExtractionStatus, AssetStatus } from "../generated/prisma/client";
import { Job, Worker } from "bullmq";
import { AiService } from "../ai/ai.service";
import { isFallbackError } from "../ai/ai-routing";
import { AiIndexQueueService } from "../ai/index/ai-index-queue.service";
import { ASSET_SOURCE } from "../ai/index/index-text";
import { AiProviderError } from "../ai/providers/ai-client";
import { redisConnectionOptions } from "../redis/redis.module";
import { ASSET_EXTRACTION_QUEUE } from "./extraction-queue.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { OfficeTextConverter } from "../office/office-text-converter";
import { type ExtractionMethod, extractDocumentText, isExtractable, normalizeMimeType } from "./text-extractors";
import { ConverterClient, ConverterRejectedError, ConverterUnavailableError } from "../converter/converter-client";
import { MarkdownEnhancerService } from "../converter/markdown-enhancer.service";
import { shouldEnhance } from "../converter/markdown-enhance";
import {
  type ConverterPrefs,
  converterHandles,
  isOcrCandidate,
  normalizeConverterPrefs,
} from "../converter/converter-logic";

/** Batas ukuran berkas yang dibaca ke memori untuk ekstraksi (lebih besar → unsupported). */
const MAX_EXTRACT_BYTES = 20 * 1024 * 1024;
/** Batas teks yang disimpan per berkas. */
const MAX_EXTRACTED_CHARS = 2_000_000;

/** Alasan berkas tidak menghasilkan teks (disimpan di `metadata.reason`). */
// `needs_gemini_key` (nama lama, tersimpan di data) = tidak ada key AI yang bisa OCR (Gemini/OpenAI/Claude)
// `ocr_off` = berkas butuh OCR AI tetapi user mematikan "Cadangan OCR AI" di Tools → Markdown Converter
type SkipReason = "unsupported_type" | "too_large" | "needs_gemini_key" | "empty" | "ocr_off";

/** Keterangan konversi Markdown Converter yang ikut disimpan di `metadata.converter`. */
interface ConverterNote {
  reason: string;
  tokens: number;
  durationMs: number;
  warnings: string[];
  fallbackFrom: string | null;
  /** Hasil "Rapikan dengan AI" (bila dinyalakan): ringkasan, atau galat (teks asli converter dipakai). */
  enhance?: {
    provider: string | null;
    model: string | null;
    parts: number;
    rejected: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
  enhanceError?: string;
}

type ReadResult =
  | { text: string; method: ExtractionMethod; pages?: number; converter?: ConverterNote }
  | { reason: SkipReason; converterError?: string };

/**
 * Ekstraksi teks berkas upload (in-process, BullMQ). Bila service Markdown Converter menyala (docs/ARCHITECTURE.md §3.14),
 * dokumen & gambar diubah ke Markdown di server sendiri: MarkItDown untuk dokumen teks, Docling (OCR Tesseract) untuk
 * gambar & PDF scan/bergambar — tanpa token AI. Tanpa converter / converter gagal: pembaca bawaan (teks, PDF, DOCX,
 * XLSX, ONLYOFFICE) lalu OCR AI milik pemilik berkas. Hasilnya dipakai semua fitur AI (ringkasan, Notes AI, My Notebook,
 * Approval, agen, indeks RAG, vault Obsidian).
 */
@Injectable()
export class ExtractionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExtractionWorkerService.name);
  private worker?: Worker<{ assetId: string }>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    @Inject(forwardRef(() => AiService)) private readonly ai: AiService,
    @Inject(forwardRef(() => AiIndexQueueService)) private readonly indexQueue: AiIndexQueueService,
    private readonly officeText: OfficeTextConverter,
    private readonly converter: ConverterClient,
    private readonly enhancer: MarkdownEnhancerService,
  ) {}

  onModuleInit() {
    const concurrency = this.config.getOrThrow<number>("EXTRACTION_CONCURRENCY");
    this.worker = new Worker(ASSET_EXTRACTION_QUEUE, async (job) => this.extract(job), {
      concurrency,
      connection: redisConnectionOptions(this.config),
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(`Extraction job ${job?.id ?? "unknown"} failed: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async extract(job: Job<{ assetId: string }>) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: job.data.assetId },
    });
    if (!asset) return;

    await this.prisma.asset.update({
      where: { id: asset.id },
      data: { status: AssetStatus.extracting },
    });
    await this.prisma.assetExtraction.update({
      where: { assetId: asset.id },
      data: {
        status: AssetExtractionStatus.extracting,
        startedAt: new Date(),
        error: null,
      },
    });

    const mimeType = normalizeMimeType(asset.mimeType, asset.originalName);
    try {
      const result = await this.readText(asset, mimeType);
      const text = "text" in result ? result.text.slice(0, MAX_EXTRACTED_CHARS) : null;

      await this.prisma.assetExtraction.update({
        where: { assetId: asset.id },
        data: {
          status: text ? AssetExtractionStatus.completed : AssetExtractionStatus.unsupported,
          extractedText: text,
          summary: text ? this.createSummary(text) : null,
          metadata: {
            mimeType,
            extractedCharacters: text?.length ?? 0,
            ...("method" in result
              ? {
                  method: result.method,
                  pages: result.pages,
                  format: result.converter ? "markdown" : "text",
                  ...(result.converter ? { converter: { ...result.converter } } : {}),
                }
              : { reason: result.reason, ...(result.converterError ? { converterError: result.converterError } : {}) }),
          },
          completedAt: new Date(),
        },
      });
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { status: AssetStatus.ready },
      });
      if (text) await this.indexQueue.enqueueSource(asset.userId, ASSET_SOURCE, asset.id);
    } catch (error) {
      const message =
        error instanceof AiProviderError
          ? `OCR Gemini: ${error.providerMessage}`
          : error instanceof Error
            ? error.message
            : "Unknown extraction error";
      await this.prisma.assetExtraction.update({
        where: { assetId: asset.id },
        data: {
          status: AssetExtractionStatus.failed,
          error: message,
          completedAt: new Date(),
        },
      });
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { status: AssetStatus.failed },
      });
      // Key ditolak / berkas rusak tidak akan berhasil bila diulang; kuota habis & gangguan jaringan diulang BullMQ
      if (!(error instanceof AiProviderError) || isFallbackError(error.kind)) throw error;
    }
  }

  private async readText(
    asset: { id: string; userId: string; objectKey: string; size: number; originalName: string; checksum: string },
    mimeType: string,
  ): Promise<ReadResult> {
    const { userId, objectKey, size, originalName: name } = asset;
    const prefs = await this.prefs(userId);
    let buffer: Buffer | null = null;
    let converterError: string | undefined;

    if (
      prefs.enabled &&
      this.converter.configured &&
      converterHandles(mimeType, name) &&
      size <= this.converter.maxBytes
    ) {
      buffer = await this.storage.getObjectBuffer(objectKey);
      try {
        const result = await this.converter.convert(buffer, name, mimeType, { pdfMode: prefs.pdfMode });
        if (result.markdown.trim()) {
          const note: ConverterNote = {
            reason: result.reason,
            tokens: result.tokens,
            durationMs: result.durationMs,
            warnings: result.warnings,
            fallbackFrom: result.fallbackFrom,
          };
          let text = result.markdown;
          if (prefs.aiEnhance && shouldEnhance(prefs.aiEnhanceScope, result.engine)) {
            // Gagal (kuota, tanpa key, teks terlalu panjang) → Markdown converter apa adanya; ekstraksi tidak gagal
            try {
              const enhanced = await this.enhancer.enhance(userId, result.markdown, {
                fileName: name,
                engine: result.engine,
              });
              text = enhanced.markdown;
              note.enhance = {
                provider: enhanced.provider,
                model: enhanced.model,
                parts: enhanced.parts,
                rejected: enhanced.rejected,
                failed: enhanced.failed,
                inputTokens: enhanced.inputTokens,
                outputTokens: enhanced.outputTokens,
                durationMs: enhanced.durationMs,
              };
            } catch (error) {
              note.enhanceError = error instanceof Error ? error.message : String(error);
              this.logger.warn(`Rapikan AI ${asset.id} gagal: ${note.enhanceError}`);
            }
          }
          return { text, method: result.engine, pages: result.pages ?? undefined, converter: note };
        }
        // Docling tidak menemukan teks (foto tanpa tulisan, tulisan tangan) → hanya AI yang mungkin bisa membaca
        if (!isOcrCandidate(mimeType, name) || !prefs.aiOcrFallback) return { reason: "empty" };
        const text = await this.ai.ocr(userId, buffer, mimeType, name);
        if (text === null) return { reason: "empty" };
        return text.trim() ? { text, method: "ocr" } : { reason: "empty" };
      } catch (error) {
        if (!(error instanceof ConverterUnavailableError || error instanceof ConverterRejectedError)) throw error;
        // Service mati / menolak berkas → pembaca bawaan di bawah (berkas tetap terbaca bila formatnya didukung)
        converterError = error.message;
        this.logger.warn(`Markdown Converter tidak membaca ${asset.id}: ${error.message}`);
      }
    }

    const builtin = await this.readBuiltin(asset, mimeType, prefs, buffer);
    return "reason" in builtin && converterError ? { ...builtin, converterError } : builtin;
  }

  private async prefs(userId: string): Promise<ConverterPrefs> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { converterPrefs: true } });
    return normalizeConverterPrefs(user?.converterPrefs);
  }

  /** Pembaca bawaan (tanpa converter): teks, PDF, DOCX, XLSX, format kantor lewat ONLYOFFICE, OCR AI. */
  private async readBuiltin(
    asset: { id: string; userId: string; objectKey: string; size: number; originalName: string; checksum: string },
    mimeType: string,
    prefs: ConverterPrefs,
    loaded: Buffer | null,
  ): Promise<ReadResult> {
    const { userId, objectKey, size, originalName: name } = asset;
    if (!isExtractable(mimeType)) {
      // Dokumen kantor lain (PPTX, ODT, RTF, DOC, ODS, XLS, …) dibaca lewat konversi ONLYOFFICE bila server diatur
      if (!this.officeText.canConvert(name)) return { reason: "unsupported_type" };
      if (size > MAX_EXTRACT_BYTES) return { reason: "too_large" };
      const text = await this.officeText.convert(asset);
      if (text === null) return { reason: "unsupported_type" };
      return text.trim() ? { text, method: "onlyoffice" } : { reason: "empty" };
    }
    if (size > MAX_EXTRACT_BYTES) return { reason: "too_large" };

    const buffer = loaded ?? (await this.storage.getObjectBuffer(objectKey));
    const outcome = await extractDocumentText(buffer, mimeType);
    if (outcome === null) return { reason: "unsupported_type" };
    if (outcome === "ocr") {
      if (!prefs.aiOcrFallback) return { reason: "ocr_off" };
      const text = await this.ai.ocr(userId, buffer, mimeType, name);
      if (text === null) return { reason: "needs_gemini_key" };
      return text.trim() ? { text, method: "ocr" } : { reason: "empty" };
    }
    return outcome.text.trim() ? outcome : { reason: "empty" };
  }

  private createSummary(text: string) {
    return text.replace(/\s+/g, " ").trim().slice(0, 500);
  }
}
