import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { domainDelegate } from "../records/record-delegate";
import { RECORD_TYPES } from "../records/record-schema";
import { ObjectStorageService } from "../storage/object-storage.service";
import { toPublicUser } from "./user.mapper";

/**
 * Akun Akasha dibuat saat pemilik pertama kali masuk lewat SSO workingspace.id; nama, email, role, dan kata sandi dikelola di SSO.
 * Di sini hanya daftar, statistik, direktori berbagi, dan hapus akun beserta datanya.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    });
    return users.map((user) => toPublicUser(user));
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User tidak ditemukan.");
    return toPublicUser(user);
  }

  /**
   * Hapus akun beserta seluruh datanya (cascade) dan berkasnya di object storage. Hanya dipanggil pembersih masa akses
   * (`AccessCleanupService`, setelah SSO memastikan akses berakhir) — akun dikelola di SSO, Akasha tidak punya tombol hapus akun.
   */
  async purge(id: string) {
    const assets = [
      ...(await this.prisma.asset.findMany({ where: { userId: id }, select: { objectKey: true } })),
      // Versi lama dokumen yang diedit di ONLYOFFICE
      ...(await this.prisma.assetVersion.findMany({ where: { asset: { userId: id } }, select: { objectKey: true } })),
    ];
    await this.prisma.user.delete({ where: { id } });
    // Data di database ikut terhapus (cascade); berkasnya dihapus dari object storage. Selain berkas yang tercatat,
    // semua objek di ruang milik akun ikut dihapus: berkas yang sedang di Sampah (barisnya sudah tidak ada, hanya
    // salinan di trash_items yang ikut terhapus cascade) dan tangkapan layar robot (bukan Asset).
    const keys = new Set(assets.map((a) => a.objectKey));
    for (const prefix of [`${id}/`, `robot/${id}/`]) {
      const found = await this.storage.listKeys(prefix).catch((error: unknown) => {
        this.logger.warn(`Daftar objek ${prefix} gagal dibaca: ${error instanceof Error ? error.message : error}`);
        return [] as string[];
      });
      found.forEach((key) => keys.add(key));
    }
    for (const objectKey of keys) {
      await this.storage
        .deleteObject(objectKey)
        .catch((error) =>
          this.logger.warn(`Objek ${objectKey} gagal dihapus: ${error instanceof Error ? error.message : error}`),
        );
    }
    return { success: true };
  }

  /**
   * Statistik per user untuk admin: jumlah data, berkas & ukurannya, berbagi, dan waktu aktif terakhir. Isi data
   * tidak pernah dikembalikan (isolasi data).
   */
  async stats() {
    const records = new Map<string, number>();
    for (const type of RECORD_TYPES) {
      const groups = await domainDelegate(this.prisma, type).groupBy({
        by: ["userId"],
        where: { deletedAt: null },
        _count: { _all: true },
      });
      for (const g of groups) records.set(g.userId, (records.get(g.userId) ?? 0) + g._count._all);
    }
    const [assets, sharesOut, sharesIn, sessions] = await Promise.all([
      this.prisma.asset.groupBy({ by: ["userId"], _count: { _all: true }, _sum: { size: true } }),
      this.prisma.share.groupBy({ by: ["ownerId"], _count: { _all: true } }),
      this.prisma.share.groupBy({ by: ["recipientId"], _count: { _all: true } }),
      this.prisma.refreshToken.groupBy({ by: ["userId"], _max: { createdAt: true } }),
    ]);
    const users = await this.prisma.user.findMany({ select: { id: true } });
    return users.map(({ id }) => {
      const asset = assets.find((a) => a.userId === id);
      return {
        userId: id,
        records: records.get(id) ?? 0,
        files: asset?._count._all ?? 0,
        storageBytes: asset?._sum.size ?? 0,
        sharesOut: sharesOut.find((s) => s.ownerId === id)?._count._all ?? 0,
        sharesIn: sharesIn.find((s) => s.recipientId === id)?._count._all ?? 0,
        lastActiveAt: sessions.find((s) => s.userId === id)?._max.createdAt ?? null,
      };
    });
  }

  /** Pencarian akun penerima berbagi: nama/email mengandung `q` (min. 3 huruf), tanpa diri sendiri. */
  async directory(q: string, actor: AuthUser) {
    const term = q.trim();
    if (term.length < 3) return [];
    return this.prisma.user.findMany({
      where: {
        id: { not: actor.id },
        OR: [{ email: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 8,
    });
  }
}
