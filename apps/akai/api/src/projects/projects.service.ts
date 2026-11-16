import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";
import type { Caller } from "../common/caller";
import { PrismaService } from "../prisma/prisma.service";
import {
  INSTRUCTIONS_MAX_CHARS,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_MAX_CHARS,
  PROJECT_MAX_FILES,
  normalizeExtracted,
  projectContext,
  projectFileKind,
} from "./project-logic";

type UploadedFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

/**
 * Proyek Akai (6b.2, docs/AKAI.md §8): kumpulan percakapan + instruksi + berkas pengetahuan. Berkas diekstrak menjadi teks saat
 * diunggah (berkas asal tidak disimpan); teks ikut konteks setiap percakapan proyek. Hanya sesi Akai web.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Proyek hanya untuk Akai web.");
  }

  async own(caller: Caller, id: string) {
    this.requireWeb(caller);
    const project = await this.prisma.project.findFirst({ where: { id, accountId: caller.account.id } });
    if (!project) throw new NotFoundException("Proyek tidak ditemukan.");
    return project;
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const rows = await this.prisma.project.findMany({
      where: { accountId: caller.account.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { files: true, conversations: true } } },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, files: _count.files, conversations: _count.conversations }));
  }

  async create(caller: Caller, input: { name: string; description?: string; instructions?: string }) {
    this.requireWeb(caller);
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new BadRequestException("Nama proyek wajib diisi.");
    return this.prisma.project.create({
      data: {
        accountId: caller.account.id,
        name,
        description: (input.description ?? "").trim().slice(0, 1000),
        instructions: (input.instructions ?? "").slice(0, INSTRUCTIONS_MAX_CHARS),
      },
    });
  }

  async get(caller: Caller, id: string) {
    const project = await this.own(caller, id);
    const [files, conversations] = await Promise.all([
      this.prisma.projectFile.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, mimeType: true, size: true, chars: true, createdAt: true },
      }),
      this.prisma.conversation.findMany({
        where: { projectId: id, accountId: caller.account.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          pinned: true,
          modelId: true,
          projectId: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
    ]);
    return { ...project, files, conversations };
  }

  async update(caller: Caller, id: string, input: { name?: string; description?: string; instructions?: string }) {
    await this.own(caller, id);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) || "Proyek" } : {}),
        ...(input.description !== undefined ? { description: input.description.trim().slice(0, 1000) } : {}),
        ...(input.instructions !== undefined
          ? { instructions: input.instructions.slice(0, INSTRUCTIONS_MAX_CHARS) }
          : {}),
      },
    });
  }

  /** Hapus proyek beserta berkas pengetahuannya; percakapan tetap ada (keluar dari proyek). */
  async remove(caller: Caller, id: string) {
    await this.own(caller, id);
    await this.prisma.project.delete({ where: { id } });
  }

  async addFile(caller: Caller, id: string, file: UploadedFile | undefined) {
    await this.own(caller, id);
    if (!file) throw new BadRequestException("Berkas tidak ada.");
    const name = Buffer.from(file.originalname, "latin1").toString("utf8").slice(0, 200);
    const kind = projectFileKind(file.mimetype, name);
    if (!kind)
      throw new BadRequestException("Jenis berkas belum didukung (PDF, DOCX, atau berkas teks seperti TXT/MD/CSV).");
    if (file.size > PROJECT_FILE_MAX_BYTES) throw new BadRequestException("Berkas terlalu besar (maks. 20 MB).");
    const stats = await this.prisma.projectFile.aggregate({
      where: { projectId: id },
      _count: true,
      _sum: { chars: true },
    });
    if (stats._count >= PROJECT_MAX_FILES)
      throw new BadRequestException(`Maks. ${PROJECT_MAX_FILES} berkas per proyek.`);

    let raw: string;
    try {
      if (kind === "pdf") {
        const { text } = await extractPdfText(new Uint8Array(file.buffer), { mergePages: true });
        raw = Array.isArray(text) ? text.join("\n\n") : text;
      } else if (kind === "docx") raw = (await mammoth.extractRawText({ buffer: file.buffer })).value;
      else raw = file.buffer.toString("utf8");
    } catch (error) {
      this.logger.warn(`Ekstraksi ${name} gagal: ${String(error)}`);
      throw new BadRequestException("Isi berkas tidak bisa dibaca (berkas rusak atau terkunci kata sandi).");
    }
    const { text, truncated } = normalizeExtracted(raw);
    if (text.replace(/\s/g, "").length < 20)
      throw new BadRequestException(
        kind === "pdf"
          ? "PDF ini tidak berisi teks (hasil scan) — belum didukung untuk pengetahuan proyek."
          : "Berkas kosong.",
      );
    if ((stats._sum.chars ?? 0) + text.length > PROJECT_MAX_CHARS)
      throw new BadRequestException(
        "Pengetahuan proyek sudah penuh (maks. ± 2 juta karakter). Hapus berkas lain dulu.",
      );
    const row = await this.prisma.projectFile.create({
      data: {
        projectId: id,
        name,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size,
        text,
        chars: text.length,
      },
      select: { id: true, name: true, mimeType: true, size: true, chars: true, createdAt: true },
    });
    await this.prisma.project.update({ where: { id }, data: { updatedAt: new Date() } });
    return { ...row, truncated };
  }

  async removeFile(caller: Caller, id: string, fileId: string) {
    await this.own(caller, id);
    const deleted = await this.prisma.projectFile.deleteMany({ where: { id: fileId, projectId: id } });
    if (!deleted.count) throw new NotFoundException("Berkas tidak ditemukan.");
  }

  /** Teks prompt sistem tambahan untuk percakapan di proyek (null = percakapan tanpa proyek / proyek hilang). */
  async contextFor(accountId: string, projectId: string | null, query: string): Promise<string | null> {
    if (!projectId) return null;
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, accountId },
      include: { files: { orderBy: { createdAt: "asc" }, select: { name: true, text: true } } },
    });
    return project ? projectContext(project, project.files, query) : null;
  }
}
