import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { RequestCategory } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  categoryKey,
  classifyRequest,
  DEFAULT_CATEGORIES,
  normalizeKeywords,
  type CategoryRule,
} from "./request-categories";

export interface CategoryInput {
  label?: string;
  description?: string | null;
  keywords?: string[];
  archived?: boolean;
  isDefault?: boolean;
  position?: number;
}

const toRule = (c: RequestCategory): CategoryRule => ({
  key: c.key,
  label: c.label,
  keywords: normalizeKeywords(c.keywords),
  archived: c.archived,
  isDefault: c.isDefault,
  position: c.position,
});

/**
 * Kategori pengajuan milik pemilik (`request_categories`). Kategori bawaan dibuat sekali saat pertama dibutuhkan, sehingga
 * pengajuan lama (kunci psp/penghapusan/…) tetap berlabel. Kunci tidak pernah berubah setelah dibuat (dipakai pengajuan &
 * Kebijakan Otomatis); yang diubah pemilik = label, keterangan, kata kunci, arsip, kategori bawaan.
 */
@Injectable()
export class RequestCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureDefaults(userId: string) {
    const count = await this.prisma.requestCategory.count({ where: { userId } });
    if (count) return;
    await this.prisma.requestCategory.createMany({
      data: DEFAULT_CATEGORIES.map((c, position) => ({
        userId,
        key: c.key,
        label: c.label,
        description: c.description,
        keywords: c.keywords,
        isDefault: !!c.isDefault,
        position,
      })),
      skipDuplicates: true,
    });
  }

  async all(userId: string) {
    await this.ensureDefaults(userId);
    return this.prisma.requestCategory.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
  }

  /** Daftar + jumlah pengajuan per kategori (kunci yang dipakai pengajuan tetapi sudah tidak ada ikut ditampilkan). */
  async list(userId: string) {
    const [rows, usage] = await Promise.all([
      this.all(userId),
      this.prisma.request.groupBy({ by: ["kind"], where: { userId }, _count: { _all: true } }),
    ]);
    const counts = new Map(usage.map((u) => [u.kind, u._count._all]));
    return rows.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      description: c.description,
      keywords: normalizeKeywords(c.keywords),
      archived: c.archived,
      isDefault: c.isDefault,
      position: c.position,
      requestCount: counts.get(c.key) ?? 0,
    }));
  }

  /** Label kategori (untuk prompt / tampilan agen); kunci tak dikenal = kunci itu sendiri. */
  async label(userId: string, key: string) {
    const row = await this.prisma.requestCategory.findFirst({ where: { userId, key }, select: { label: true } });
    return row?.label ?? key;
  }

  async labels(userId: string) {
    const rows = await this.all(userId);
    return new Map(rows.map((c) => [c.key, c.label]));
  }

  /** Kunci yang boleh dipakai untuk pengajuan baru / perubahan: harus ada dan tidak diarsipkan. */
  async assertUsable(userId: string, key: string) {
    const rows = await this.all(userId);
    const row = rows.find((c) => c.key === key);
    if (!row) throw new BadRequestException(`Kategori "${key}" tidak dikenal. Pilih dari daftar kategori.`);
    if (row.archived) throw new BadRequestException(`Kategori "${row.label}" sudah diarsipkan.`);
    return row;
  }

  /** Kategori otomatis dari teks pengajuan (kata kunci); `matched` = kata kunci yang cocok, null = kategori bawaan. */
  async classify(userId: string, text: string) {
    const rows = await this.all(userId);
    return classifyRequest(rows.map(toRule), text);
  }

  async create(userId: string, input: CategoryInput) {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException("Nama kategori wajib diisi.");
    const rows = await this.all(userId);
    if (rows.some((c) => c.label.toLowerCase() === label.toLowerCase()))
      throw new ConflictException("Nama kategori sudah dipakai.");
    const created = await this.prisma.requestCategory.create({
      data: {
        userId,
        key: categoryKey(
          label,
          rows.map((c) => c.key),
        ),
        label: label.slice(0, 120),
        description: input.description?.trim().slice(0, 500) || null,
        keywords: normalizeKeywords(input.keywords ?? []),
        position: input.position ?? Math.max(-1, ...rows.map((c) => c.position)) + 1,
      },
    });
    if (input.isDefault) await this.setDefault(userId, created.id);
    return created;
  }

  async update(userId: string, id: string, input: CategoryInput) {
    const row = await this.prisma.requestCategory.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Kategori tidak ditemukan.");
    const label = input.label?.trim();
    if (input.label !== undefined && !label) throw new BadRequestException("Nama kategori wajib diisi.");
    if (label && label.toLowerCase() !== row.label.toLowerCase()) {
      const clash = await this.prisma.requestCategory.findFirst({
        where: { userId, id: { not: id }, label: { equals: label, mode: "insensitive" } },
      });
      if (clash) throw new ConflictException("Nama kategori sudah dipakai.");
    }
    if (input.archived && (input.isDefault ?? row.isDefault))
      throw new BadRequestException(
        "Kategori bawaan tidak bisa diarsipkan. Jadikan kategori lain sebagai bawaan dulu.",
      );
    const updated = await this.prisma.requestCategory.update({
      where: { id },
      data: {
        ...(label ? { label: label.slice(0, 120) } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim().slice(0, 500) || null } : {}),
        ...(input.keywords ? { keywords: normalizeKeywords(input.keywords) } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    if (input.isDefault) await this.setDefault(userId, id);
    return updated;
  }

  private async setDefault(userId: string, id: string) {
    await this.prisma.$transaction([
      this.prisma.requestCategory.updateMany({ where: { userId, id: { not: id } }, data: { isDefault: false } }),
      this.prisma.requestCategory.update({ where: { id }, data: { isDefault: true, archived: false } }),
    ]);
  }

  /** Hapus hanya kategori yang belum dipakai pengajuan / Kebijakan Otomatis; selain itu arsipkan. */
  async remove(userId: string, id: string) {
    const row = await this.prisma.requestCategory.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Kategori tidak ditemukan.");
    if (row.isDefault) throw new BadRequestException("Kategori bawaan tidak bisa dihapus.");
    const [requests, policies] = await Promise.all([
      this.prisma.request.count({ where: { userId, kind: row.key } }),
      this.prisma.agentPolicy.count({ where: { userId, requestKind: row.key } }),
    ]);
    if (requests || policies)
      throw new ConflictException(
        `Kategori dipakai ${requests} pengajuan${policies ? ` dan ${policies} aturan Kebijakan Otomatis` : ""}. Arsipkan saja.`,
      );
    await this.prisma.requestCategory.delete({ where: { id } });
    return { deleted: true };
  }
}
