import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConverterClient } from "./converter-client";
import {
  type ConverterMode,
  type ConverterPdfMode,
  LIBRARY_MAX_DOCUMENTS,
  LIBRARY_MAX_PENDING,
  libraryAccepts,
  libraryTitle,
  librarySummary,
} from "./converter-logic";
import { ConverterService } from "./converter.service";

type UploadFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type LibraryOptions = { mode?: ConverterMode; pdfMode?: ConverterPdfMode; enhance?: boolean; compareTokens?: boolean };
type Job = { id: string; userId: string; file: UploadFile; options: LibraryOptions };

/** Konversi paralel di satu proses (Docling di service converter tetap satu per satu). */
const CONCURRENCY = 2;

/** Kolom daftar pustaka: tanpa isi Markdown agar daftar ringan. */
const LIST_SELECT = {
  id: true,
  title: true,
  fileName: true,
  mimeType: true,
  size: true,
  options: true,
  status: true,
  error: true,
  engine: true,
  result: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
} satisfies Prisma.ConvertedDocumentSelect;

/**
 * Pustaka Markdown Converter (Tools → Markdown Converter → Dokumen): hasil konversi disimpan per user dan bisa dibuka lagi.
 * Berkas asal **tidak** disimpan — hanya dipegang di memori selama diproses — sehingga tidak ada sampah di storage; hapus =
 * baris dihapus permanen. Antrean di memori satu proses: backend restart = dokumen yang belum selesai ditandai gagal.
 */
@Injectable()
export class ConverterLibraryService implements OnModuleInit {
  private readonly logger = new Logger(ConverterLibraryService.name);
  private readonly queue: Job[] = [];
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ConverterClient,
    private readonly converter: ConverterService,
  ) {}

  async onModuleInit() {
    // Berkas asal hanya ada di memori proses sebelumnya → tidak bisa dilanjutkan
    await this.prisma.convertedDocument
      .updateMany({
        where: { status: { in: ["queued", "processing"] } },
        data: {
          status: "failed",
          error: "Server dimulai ulang sebelum konversi selesai. Unggah ulang berkasnya.",
          finishedAt: new Date(),
        },
      })
      .catch((error: unknown) => this.logger.warn(`Gagal membersihkan antrean pustaka: ${String(error)}`));
  }

  async list(userId: string) {
    const rows = await this.prisma.convertedDocument.findMany({
      where: { userId },
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
      take: LIBRARY_MAX_DOCUMENTS,
    });
    return rows.map(({ result, ...row }) => ({ ...row, summary: librarySummary(result) }));
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.convertedDocument.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Dokumen hasil konversi tidak ditemukan.");
    return { ...row, summary: librarySummary(row.result) };
  }

  async create(userId: string, file: UploadFile, options: LibraryOptions) {
    if (!this.client.configured) {
      throw new UnprocessableEntityException(
        "Markdown Converter belum diatur di server (CONVERTER_URL & CONVERTER_TOKEN).",
      );
    }
    if (file.size > this.client.maxBytes) {
      throw new BadRequestException(`Berkas maksimal ${this.client.maxBytes / 1024 / 1024} MB.`);
    }
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    if (!libraryAccepts(file.mimetype, name)) {
      throw new BadRequestException("Format berkas ini tidak bisa dikonversi ke Markdown.");
    }
    const [pending, total] = await Promise.all([
      this.prisma.convertedDocument.count({ where: { userId, status: { in: ["queued", "processing"] } } }),
      this.prisma.convertedDocument.count({ where: { userId } }),
    ]);
    if (pending >= LIBRARY_MAX_PENDING) {
      throw new BadRequestException(`Masih ada ${pending} berkas dalam antrean. Tunggu sebagian selesai dulu.`);
    }
    if (total >= LIBRARY_MAX_DOCUMENTS) {
      throw new BadRequestException(`Pustaka penuh (${LIBRARY_MAX_DOCUMENTS} dokumen). Hapus dokumen lama dulu.`);
    }
    const row = await this.prisma.convertedDocument.create({
      data: {
        userId,
        title: libraryTitle(name),
        fileName: name,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size,
        options: { ...options },
        status: "queued",
      },
      select: LIST_SELECT,
    });
    this.queue.push({ id: row.id, userId, file, options });
    this.pump();
    const { result, ...rest } = row;
    return { ...rest, summary: librarySummary(result) };
  }

  async rename(userId: string, id: string, title: string) {
    const clean = title.replace(/\s+/g, " ").trim();
    if (!clean) throw new BadRequestException("Judul tidak boleh kosong.");
    const { count } = await this.prisma.convertedDocument.updateMany({ where: { id, userId }, data: { title: clean } });
    if (!count) throw new NotFoundException("Dokumen hasil konversi tidak ditemukan.");
    return { id, title: clean };
  }

  /** Hapus permanen (tidak lewat Sampah: hanya teks hasil konversi, berkas asal tidak pernah disimpan). */
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.convertedDocument.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException("Dokumen hasil konversi tidak ditemukan.");
    const index = this.queue.findIndex((job) => job.id === id);
    if (index >= 0) this.queue.splice(index, 1);
    return { deleted: true };
  }

  private pump() {
    while (this.running < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void this.process(job)
        .catch((error: unknown) => this.logger.error(`Konversi pustaka ${job.id} gagal: ${String(error)}`))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private async process(job: Job) {
    // Dokumen dihapus sebelum diproses → tidak ada yang perlu dikerjakan
    const started = await this.prisma.convertedDocument.updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "processing" },
    });
    if (!started.count) return;
    try {
      const result = await this.converter.convert(job.userId, job.file, job.options);
      const { markdown, enhanced, engine, ...rest } = result;
      const enhancedMeta = enhanced ? { ...enhanced, markdown: undefined } : null;
      await this.prisma.convertedDocument.updateMany({
        where: { id: job.id },
        data: {
          status: "done",
          error: null,
          engine,
          markdown,
          enhancedMarkdown: enhanced?.markdown ?? null,
          result: JSON.parse(JSON.stringify({ ...rest, enhanced: enhancedMeta })) as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      const message =
        error instanceof HttpException ? error.message : error instanceof Error ? error.message : String(error);
      await this.prisma.convertedDocument.updateMany({
        where: { id: job.id },
        data: { status: "failed", error: message.slice(0, 1000), finishedAt: new Date() },
      });
    } finally {
      // Lepaskan berkas dari memori secepatnya
      job.file.buffer = Buffer.alloc(0);
    }
  }
}
