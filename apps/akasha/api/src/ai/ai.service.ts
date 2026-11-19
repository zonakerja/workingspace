import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AKAI_REQUIRED, AkaiError, AkaiService, type AkaiUser } from "../akai/akai.service";
import { PrismaService } from "../prisma/prisma.service";
import { type AiAttachment, AiProviderError } from "./ai-errors";
import { attachmentKind } from "./ai-providers";
import type { AiTask } from "./ai-routing";
import type { EmbeddingTarget } from "./index/embedding";
import { EMBEDDING_DIMENSIONS } from "./index/index-text";
import { UpdateAiSettingsDto } from "./dto/ai.dto";
import { AiIndexQueueService } from "./index/ai-index-queue.service";

/** Batas total lampiran per permintaan (dikirim inline ke gateway Akai). */
export const AI_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const AI_MAX_ATTACHMENTS = 5;

const OCR_PROMPT =
  "Salin seluruh teks yang terlihat pada dokumen/gambar ini apa adanya, pertahankan urutan, baris, dan tabel (tulis tabel dengan pemisah |). Bila tidak ada teks sama sekali, tulis deskripsi singkat isi gambar diawali 'Deskripsi gambar:'. Jangan menambahkan komentar lain.";

export interface AiFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Model embedding indeks (model utama tugas Embedding di Akai, `akai/<ID>`) + pemanggil gateway. */
export type EmbeddingCredential = EmbeddingTarget;

/** Hasil `generate`: selalu dijawab gateway Akai (`model` = nama model di Akai). */
export interface AiGenerateResult {
  text: string;
  provider: "akai";
  model: string;
  fallback: { from: "akai"; reason: "unavailable"; message: string } | null;
}

/**
 * Fitur AI Akasha lewat gateway Akai (docs/KAJIAN-AI-TERPUSAT.md): Akasha tidak menyimpan API key — model, cadangan, dan
 * biaya diatur di Akai → Model. Akai tidak dapat dihubungi = AI berhenti dengan pesan jelas (keputusan pemilik).
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexQueue: AiIndexQueueService,
    private readonly akai: AkaiService,
  ) {}

  private akaiUser(userId: string): Promise<AkaiUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { ssoSubject: true, email: true, name: true },
    });
  }

  // ---------------------------------------------------------------- Pengaturan

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { aiIndexEnabled: true, ssoSubject: true, email: true, name: true },
    });
    const tasks = await this.akai.status(user, true);
    return {
      /** `available` = Akai aktif di server & akun masuk lewat SSO; `tasks` = jumlah model per tugas (null = tak terjangkau). */
      akai: {
        available: this.akai.enabled && !!user.ssoSubject,
        reachable: tasks !== null,
        webUrl: this.akai.webUrl,
        tasks,
      },
      indexEnabled: user.aiIndexEnabled,
    };
  }

  /** Sakelar indeks pengetahuan (RAG). */
  async updateSettings(userId: string, dto: UpdateAiSettingsDto) {
    if (dto.indexEnabled !== undefined) {
      await this.prisma.user.update({ where: { id: userId }, data: { aiIndexEnabled: dto.indexEnabled } });
      // Dimatikan → indeks dihapus; dinyalakan → dibangun dari awal
      if (dto.indexEnabled) await this.indexQueue.enqueueRebuild(userId);
      else await this.indexQueue.enqueuePurge(userId);
    }
    return this.getSettings(userId);
  }

  // ---------------------------------------------------------------- Dipakai indeks & ekstraksi

  /** Model embedding indeks: tugas Embedding di Akai (akun SSO). null = pencarian kata saja. */
  async embeddingCredential(userId: string): Promise<EmbeddingCredential | null> {
    const user = await this.akaiUser(userId);
    if (!user) return null;
    const model = await this.akai.embeddingModel(user);
    if (!model) return null;
    return { model, remote: (texts) => this.akai.embed(user, texts, EMBEDDING_DIMENSIONS) };
  }

  /**
   * Baca teks dari gambar / PDF hasil scan lewat tugas OCR di Akai. null = tugas OCR belum diatur (berkas tetap tersimpan,
   * hanya tidak terbaca). Galat dilempar sebagai `AiProviderError` (kuota / Akai tak terjangkau = dicoba lagi nanti).
   */
  async ocr(userId: string, data: Buffer, mimeType: string, name: string) {
    const kind = mimeType === "application/pdf" ? "pdf" : "image";
    const user = await this.akaiUser(userId);
    if (!user || !(await this.akai.handles(user, "ocr"))) return null;
    try {
      const result = await this.akai.generate(user, "ocr", OCR_PROMPT, [{ kind, mimeType, name, data }]);
      return result?.text ?? null;
    } catch (error) {
      if (!(error instanceof AkaiError)) throw error;
      throw new AiProviderError(
        error.unreachable ? "unavailable" : error.status === 429 ? "quota" : "invalid",
        error.message,
      );
    }
  }

  // ---------------------------------------------------------------- Generate

  /** Jawab prompt lewat gateway Akai menurut tugas (model & cadangan dipilih Akai). */
  async generate(
    userId: string,
    prompt: string,
    files: AiFile[] = [],
    task: Exclude<AiTask, "ocr"> = "general",
  ): Promise<AiGenerateResult> {
    const attachments = this.toAttachments(files);
    if (attachments.some((a) => a.kind === "audio")) {
      throw new BadRequestException(
        "Lampiran audio tidak dikirim ke AI. Transkrip audionya dulu (Notes AI → Transkrip).",
      );
    }
    const user = await this.akaiUser(userId);
    if (!user || !this.akai.enabled || !user.ssoSubject) throw new BadRequestException(AKAI_REQUIRED);
    if (!(await this.akai.handles(user, task))) {
      const status = await this.akai.status(user);
      if (status === null) throw new UnprocessableEntityException("Akai tidak dapat dihubungi. Coba lagi sebentar.");
      throw new BadRequestException(`Model untuk tugas ini belum diatur. ${AKAI_REQUIRED}`);
    }
    try {
      const result = await this.akai.generate(user, task, prompt, attachments);
      if (!result) throw new UnprocessableEntityException("AI tidak memberikan jawaban.");
      return {
        text: result.text,
        provider: "akai",
        model: result.model,
        fallback: result.fallbackFrom
          ? {
              from: "akai",
              reason: "unavailable",
              message: `Dijawab ${result.model} (cadangan di Akai) karena ${result.fallbackFrom} tidak dapat dipakai.`,
            }
          : null,
      };
    } catch (error) {
      throw this.akaiHttpError(error);
    }
  }

  /** Galat Akai → HTTP: kuota 429, isian 400, lainnya 422 (bukan 401 / ≥ 502, lihat CLAUDE.md §15). */
  private akaiHttpError(error: unknown) {
    if (!(error instanceof AkaiError)) return error;
    if (error.status === 429) return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
    if (error.status === 400) return new BadRequestException(error.message);
    return new UnprocessableEntityException(error.message);
  }

  private toAttachments(files: AiFile[]): AiAttachment[] {
    if (files.length > AI_MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maksimal ${AI_MAX_ATTACHMENTS} lampiran per permintaan AI.`);
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > AI_MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException("Total lampiran untuk AI maksimal 20 MB.");
    }
    return files.map((file) => {
      // Multer mendekode nama file sebagai latin1; kembalikan ke UTF-8
      const name = Buffer.from(file.originalname, "latin1").toString("utf8");
      const kind = attachmentKind(file.mimetype);
      if (!kind) {
        throw new BadRequestException(`Format "${name}" tidak didukung AI. Gunakan PDF, gambar, atau teks.`);
      }
      return { kind, mimeType: file.mimetype.split(";")[0].trim().toLowerCase(), name, data: file.buffer };
    });
  }
}
