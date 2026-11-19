import { BadRequestException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { ExtractionQueueService } from "../extraction/extraction-queue.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { AiProviderError } from "../ai/ai-errors";
import { ConverterClient, ConverterRejectedError, ConverterUnavailableError } from "./converter-client";
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

/** Tools → Markdown Converter: status service, preferensi per user, konversi untuk pustaka Dokumen, konversi ulang berkas lama. */
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

  /** Konversi satu berkas di memori (dipakai antrean pustaka Dokumen; berkas tidak disimpan). */
  async convert(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    options: { mode?: ConverterMode; pdfMode?: ConverterPdfMode; enhance?: boolean },
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
      return { ...result, fileName: name, size: file.size, enhanced, enhanceError };
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
