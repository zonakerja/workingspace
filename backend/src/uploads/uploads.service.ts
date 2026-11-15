import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  type Asset,
  AssetExtractionStatus,
  AssetStatus,
  type AssetVersion,
  Prisma,
  type PublicLink,
  type TrashItem,
} from "../generated/prisma/client";
import { AiIndexQueueService } from "../ai/index/ai-index-queue.service";
import { type TrashSource } from "../trash/trash-logic";
import { TrashService } from "../trash/trash.service";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AuthUser } from "../common/types/auth-user";
import { ASSET_SOURCE } from "../ai/index/index-text";
import { KNOWLEDGE_VAULT_CONTEXT } from "../knowledge/knowledge-constants";
import { ExtractionQueueService } from "../extraction/extraction-queue.service";
import { PrismaService } from "../prisma/prisma.service";
import { type SharePermission } from "../sharing/share-graph";
import { ShareAccessService } from "../sharing/share-access.service";
import { LockService } from "../security/lock.service";
import { ObjectStorageService } from "../storage/object-storage.service";

const DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60;

type DownloadTokenPayload = {
  sub: string;
  assetId: string;
  purpose: "download";
};

const ASSET_INCLUDE = {
  extraction: {
    select: { status: true, summary: true, error: true, completedAt: true },
  },
} as const;

/** Salinan berkas di Sampah (lihat `UploadsService.moveToTrash`). */
type AssetTrashSnapshot = {
  asset: Omit<Asset, "createdAt" | "updatedAt" | "versionedAt"> & {
    createdAt: string;
    updatedAt: string;
    versionedAt: string | null;
  };
  versions: (Omit<AssetVersion, "createdAt"> & { createdAt: string })[];
  extraction: {
    status: AssetExtractionStatus;
    extractedText: string | null;
    summary: string | null;
    metadata: unknown;
    error: string | null;
    completedAt: string | null;
  } | null;
  publicLinks: (Omit<PublicLink, "createdAt" | "expiresAt" | "lastAccessAt"> & {
    createdAt: string;
    expiresAt: string | null;
    lastAccessAt: string | null;
  })[];
  finalIds: string[];
};

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly queue: ExtractionQueueService,
    private readonly jwt: JwtService,
    private readonly shareAccess: ShareAccessService,
    private readonly trash: TrashService,
    private readonly moduleRef: ModuleRef,
    // Berkas milik item terkunci PIN hanya terbuka di sesi yang sudah memasukkan PIN
    private readonly locks: LockService,
  ) {}

  onModuleInit() {
    this.trash.registerHandler("asset", {
      restore: (item) => this.restoreFromTrash(item),
      purge: (item) => this.purgeFromTrash(item),
    });
  }

  async upload(file: Express.Multer.File, user: AuthUser, context?: string, ownerId?: string) {
    try {
      return await this.store(file, user, context, ownerId);
    } finally {
      // Berkas sementara dari multer selalu dihapus, sukses maupun gagal
      await unlink(file.path).catch(() => undefined);
    }
  }

  private async store(file: Express.Multer.File, user: AuthUser, context?: string, requestedOwner?: string) {
    const ownerId = await this.resolveOwner(user, requestedOwner);

    // Multer mendekode nama file sebagai latin1; kembalikan ke UTF-8
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const hasher = createHash("sha256");
    await pipeline(createReadStream(file.path), hasher);
    return this.persist({
      ownerId,
      uploaderId: user.id,
      originalName,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      checksum: hasher.digest("hex"),
      body: () => createReadStream(file.path),
      context,
    });
  }

  /**
   * Berkas baru dari isi di memori (mis. dokumen kosong dari templat ONLYOFFICE). `ownerId` = pemilik item bersama
   * (izin edit) tempat berkas dilampirkan, sama seperti upload biasa.
   */
  async createFromBuffer(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    user: AuthUser,
    context?: string,
    ownerId?: string,
  ) {
    return this.persist({
      ownerId: await this.resolveOwner(user, ownerId),
      uploaderId: user.id,
      originalName,
      mimeType,
      size: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      body: () => buffer,
      context,
    });
  }

  /** Key objek storage baru di ruang pemilik: `<userId>/<yyyy>/<mm>/<ts>-<uuid><ext>`. */
  newObjectKey(ownerId: string, originalName: string) {
    const now = new Date();
    return [
      ownerId,
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${now.getTime()}-${randomUUID()}${extname(originalName).toLowerCase()}`,
    ].join("/");
  }

  private async persist(params: {
    ownerId: string;
    uploaderId: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum: string;
    body: () => Buffer | Readable;
    context?: string;
  }) {
    const { ownerId, originalName, mimeType, checksum, context } = params;
    const objectKey = this.newObjectKey(ownerId, originalName);

    await this.storage.putObject({
      key: objectKey,
      body: params.body(),
      contentLength: params.size,
      contentType: mimeType,
      checksum,
    });

    let asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
          userId: ownerId,
          uploadedById: ownerId === params.uploaderId ? null : params.uploaderId,
          bucket: this.storage.bucket,
          objectKey,
          originalName,
          mimeType,
          size: params.size,
          checksum,
          status: AssetStatus.queued,
          context,
          extraction: { create: {} },
        },
        include: ASSET_INCLUDE,
      });
    } catch (error) {
      // Kompensasi: jangan tinggalkan objek yatim di storage
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }

    try {
      await this.queue.enqueue(asset.id);
    } catch (error) {
      this.logger.error(`Gagal enqueue ekstraksi ${asset.id}: ${error instanceof Error ? error.message : error}`);
    }

    return this.toResponse(asset);
  }

  async list(user: AuthUser, take = 50) {
    const assets = await this.prisma.asset.findMany({
      // Berkas vault Obsidian dikelola konektor basis pengetahuan, bukan daftar berkas biasa
      where: { userId: user.id, OR: [{ context: null }, { context: { not: KNOWLEDGE_VAULT_CONTEXT } }] },
      include: ASSET_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 100),
    });
    return assets.map((asset) => this.toResponse(asset));
  }

  async getMetadata(id: string, user: AuthUser) {
    const asset = await this.findAccessible(id, user, true);
    return asset;
  }

  async openStream(id: string, user: AuthUser) {
    const asset = await this.findAccessible(id, user);
    return { asset, stream: await this.storage.getObject(asset.objectKey) };
  }

  async createDownloadLink(id: string, user: AuthUser) {
    const asset = await this.findAccessible(id, user);
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        assetId: asset.id,
        purpose: "download",
      } satisfies DownloadTokenPayload,
      { expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS },
    );
    return {
      url: `/uploads/${asset.id}/download?token=${encodeURIComponent(token)}`,
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    };
  }

  async openStreamWithToken(id: string, token: string) {
    let payload: DownloadTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<DownloadTokenPayload>(token);
    } catch {
      throw new UnauthorizedException("Link unduhan tidak valid atau kedaluwarsa.");
    }
    if (payload.purpose !== "download" || payload.assetId !== id) {
      throw new UnauthorizedException("Link unduhan tidak valid.");
    }

    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("File tidak ditemukan.");
    return { asset, stream: await this.storage.getObject(asset.objectKey) };
  }

  /**
   * Hanya pemilik, atau kolaborator yang mengunggahnya (mis. membatalkan upload di item bersama).
   * `trash: true` = pindah ke Sampah (baris disimpan sebagai salinan, objek storage dibiarkan sampai masa simpan habis);
   * bawaan = hapus permanen (unggahan yang belum pernah disimpan, pembersihan internal modul lain).
   */
  async remove(id: string, user: AuthUser, options: { trash?: boolean; source?: TrashSource } = {}) {
    const asset = await this.findAccessible(id, user);
    if (asset.userId !== user.id && asset.uploadedById !== user.id) {
      throw new ForbiddenException("Hanya pemilik yang dapat menghapus file ini.");
    }
    // Berkas yang menjadi sumber My Notebook tidak dihapus dari fitur lain (mis. dokumen Notes AI diganti, resource
    // dihapus); notebook menghapus berkas unggahannya sendiri setelah sumbernya dilepas.
    const sourceCount = await this.prisma.notebookSource.count({ where: { assetId: asset.id } });
    if (sourceCount > 0) {
      throw new ConflictException("Berkas masih dipakai sebagai sumber My Notebook. Lepaskan dari notebook dulu.");
    }
    // Berkas bukti di brankas digital renaksi (tautan sudah diserahkan ke e-Kinerja) tidak dihapus diam-diam
    const vaultCount = await this.prisma.publicVaultFile.count({ where: { assetId: asset.id } });
    if (vaultCount > 0) {
      throw new ConflictException(
        "Berkas masih menjadi bukti di brankas digital renaksi. Keluarkan dari brankas dulu.",
      );
    }
    if (options.trash) return this.moveToTrash(asset.id, user, options.source);
    // Versi lama (editor ONLYOFFICE) ikut terhapus (cascade); objek storage-nya dihapus di bawah
    const versions = await this.prisma.assetVersion.findMany({
      where: { assetId: asset.id },
      select: { objectKey: true },
    });
    // Potongan indeks AI (RAG) dari isi berkas ikut dihapus
    await this.prisma.$transaction([
      this.prisma.aiChunk.deleteMany({ where: { sourceType: ASSET_SOURCE, sourceId: asset.id } }),
      this.prisma.asset.delete({ where: { id: asset.id } }),
    ]);
    for (const objectKey of [asset.objectKey, ...versions.map((v) => v.objectKey)]) {
      await this.storage
        .deleteObject(objectKey)
        .catch((error) =>
          this.logger.warn(`Objek ${objectKey} gagal dihapus: ${error instanceof Error ? error.message : error}`),
        );
    }
    return { success: true };
  }

  /**
   * Baris berkas + versi + hasil ekstraksi + tautan publik disalin ke Sampah lalu dihapus dari tabel (berkas tidak lagi
   * terlihat di mana pun); objek storage tetap ada sehingga pemulihan membuat ulang baris dengan ID yang sama dan
   * lampiran yang merujuknya kembali berfungsi tanpa membaca/OCR ulang.
   */
  private async moveToTrash(id: string, user: AuthUser, source?: TrashSource) {
    const full = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: { versions: true, extraction: true, publicLinks: true, finals: { select: { id: true } } },
    });
    const { versions, extraction, publicLinks, finals, ...asset } = full;
    const snapshot = {
      asset,
      versions,
      extraction: extraction
        ? {
            status: extraction.status,
            extractedText: extraction.extractedText,
            summary: extraction.summary,
            metadata: extraction.metadata,
            error: extraction.error,
            completedAt: extraction.completedAt,
          }
        : null,
      publicLinks,
      finalIds: finals.map((f) => f.id),
    };
    const batchId = await this.prisma.$transaction(async (tx) => {
      await tx.aiChunk.deleteMany({ where: { sourceType: ASSET_SOURCE, sourceId: id } });
      await tx.asset.delete({ where: { id } });
      return this.trash.add(
        {
          userId: asset.userId,
          kind: "asset",
          itemId: id,
          title: asset.originalName,
          actorId: user.id,
          source,
          snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return { success: true, trashed: true, batchId };
  }

  private async restoreFromTrash(item: TrashItem) {
    const snapshot = item.snapshot as unknown as AssetTrashSnapshot | null;
    if (!snapshot?.asset) throw new Error("Salinan berkas tidak lengkap.");
    if (await this.prisma.asset.findUnique({ where: { id: item.itemId } })) return;
    const { asset, versions, extraction, publicLinks, finalIds } = snapshot;
    const completed = extraction?.status === AssetExtractionStatus.completed && !!extraction.extractedText;
    await this.prisma.$transaction(async (tx) => {
      const draftExists = asset.draftId ? !!(await tx.asset.findUnique({ where: { id: asset.draftId } })) : false;
      await tx.asset.create({
        data: {
          ...asset,
          draftId: draftExists ? asset.draftId : null,
          extraction: {
            create: completed
              ? {
                  status: extraction.status,
                  extractedText: extraction.extractedText,
                  summary: extraction.summary,
                  metadata: (extraction.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
                  completedAt: extraction.completedAt,
                }
              : {},
          },
        },
      });
      if (versions.length) await tx.assetVersion.createMany({ data: versions, skipDuplicates: true });
      if (publicLinks.length) await tx.publicLink.createMany({ data: publicLinks, skipDuplicates: true });
      if (finalIds.length)
        await tx.asset.updateMany({ where: { id: { in: finalIds }, draftId: null }, data: { draftId: asset.id } });
    });
    // Teks hasil baca disimpan di Sampah → langsung diindeks; selain itu dibaca ulang
    // Antrean indeks diambil saat dipakai: modul AI bergantung pada modul ini, jadi tidak diinjeksi lewat konstruktor
    if (completed)
      void this.moduleRef
        .get(AiIndexQueueService, { strict: false })
        .enqueueSource(asset.userId, ASSET_SOURCE, asset.id);
    else await this.queue.enqueue(asset.id).catch(() => undefined);
  }

  private async purgeFromTrash(item: TrashItem) {
    const snapshot = item.snapshot as unknown as AssetTrashSnapshot | null;
    if (!snapshot?.asset) return;
    // Berkas yang sudah dipulihkan lewat jalur lain tidak boleh kehilangan objeknya
    if (await this.prisma.asset.findUnique({ where: { id: item.itemId } })) return;
    for (const objectKey of [snapshot.asset.objectKey, ...snapshot.versions.map((v) => v.objectKey)]) {
      await this.storage.deleteObject(objectKey);
    }
  }

  /**
   * Berkas dapat dibaca oleh pemiliknya, pengunggahnya, dan penerima berbagi yang dapat mengakses item yang
   * melampirkan berkas itu (lihat `src/sharing/`). Admin tidak punya akses khusus.
   */
  private async findAccessible(id: string, user: AuthUser, withExtraction = false) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: withExtraction ? { extraction: true } : undefined,
    });
    if (!asset) throw new NotFoundException("File tidak ditemukan.");
    if (asset.userId !== user.id && asset.uploadedById !== user.id) {
      const shared = (await this.shareAccess.forUser(user.id)).get(asset.userId)?.uploads.has(asset.id);
      if (!shared) throw new ForbiddenException("Anda tidak memiliki akses ke file ini.");
    }
    await this.locks.assertAssetOpen(user, asset.userId, asset.id);
    return asset;
  }

  /**
   * Berkas + tingkat akses user: pemilik/pengunggah = `edit`, penerima berbagi = izin tertinggi item yang merujuknya.
   * `fresh` = hitung ulang tanpa cache (pemeriksaan tulis).
   */
  async findWithPermission(id: string, user: AuthUser, fresh = false) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("File tidak ditemukan.");
    await this.locks.assertAssetOpen(user, asset.userId, asset.id);
    if (asset.userId === user.id || asset.uploadedById === user.id) {
      return { asset, permission: "edit" as SharePermission };
    }
    const access = fresh
      ? await this.shareAccess.forOwner(user.id, asset.userId)
      : (await this.shareAccess.forUser(user.id)).get(asset.userId);
    const permission = access?.uploads.get(asset.id);
    if (!permission) throw new ForbiddenException("Anda tidak memiliki akses ke file ini.");
    return { asset, permission };
  }

  /** Pemilik berkas: diri sendiri, atau pemilik item bersama yang memberi izin edit kepada pengunggah. */
  private async resolveOwner(user: AuthUser, requested?: string) {
    if (!requested || requested === user.id) return user.id;
    const share = await this.prisma.share.findFirst({
      where: { ownerId: requested, recipientId: user.id, permission: "edit" },
      select: { id: true },
    });
    if (!share) throw new ForbiddenException("Anda tidak memiliki izin edit atas data user tersebut.");
    return requested;
  }

  private toResponse(asset: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum: string;
    status: AssetStatus;
    context: string | null;
    createdAt: Date;
    extraction: {
      status: string;
      summary: string | null;
      error: string | null;
      completedAt: Date | null;
    } | null;
  }) {
    return {
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      checksum: asset.checksum,
      status: asset.status,
      context: asset.context,
      extractionStatus: asset.extraction?.status ?? null,
      summary: asset.extraction?.summary ?? null,
      createdAt: asset.createdAt,
      url: `/uploads/${asset.id}`,
    };
  }
}
