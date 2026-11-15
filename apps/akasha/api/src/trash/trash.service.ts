import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type TrashItem } from "../generated/prisma/client";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { chooseBatch, type TrashKind, type TrashSource, trashExpiry } from "./trash-logic";

/** Cara memulihkan / menghapus permanen satu jenis item; didaftarkan modul pemilik datanya (tanpa ketergantungan melingkar). */
export interface TrashHandler {
  restore(item: TrashItem): Promise<void>;
  purge(item: TrashItem): Promise<void>;
}

export interface TrashEntryInput {
  userId: string;
  kind: TrashKind;
  recordType?: string;
  itemId: string;
  title: string;
  actorId: string | null;
  source?: TrashSource;
  snapshot?: Prisma.InputJsonValue;
}

/** Pembersihan otomatis item kedaluwarsa (6 jam sekali; mulai 1 menit setelah start). */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PURGE_START_DELAY_MS = 60_000;

const LIST_SELECT = {
  id: true,
  kind: true,
  recordType: true,
  itemId: true,
  title: true,
  batchId: true,
  actorId: true,
  source: true,
  deletedAt: true,
  expiresAt: true,
} satisfies Prisma.TrashItemSelect;

/**
 * Sampah: semua penghapusan (oleh user maupun agen) bisa dipulihkan selama masa simpan, lalu dihapus permanen.
 * Modul pemilik data mendaftarkan `TrashHandler` untuk jenisnya (`registerHandler`).
 */
@Injectable()
export class TrashService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrashService.name);
  private readonly handlers = new Map<TrashKind, TrashHandler>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timers.push(setTimeout(() => void this.purgeExpired(), PURGE_START_DELAY_MS));
    this.timers.push(setInterval(() => void this.purgeExpired(), PURGE_INTERVAL_MS));
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  registerHandler(kind: TrashKind, handler: TrashHandler) {
    this.handlers.set(kind, handler);
  }

  /** Catat item yang baru dihapus (dalam transaksi pemanggil bila ada); hasil = kelompoknya (untuk tombol Pulihkan). */
  async add(input: TrashEntryInput, tx: Prisma.TransactionClient = this.prisma) {
    const now = new Date();
    const source = input.source ?? "user";
    const last = await tx.trashItem.findFirst({
      where: { userId: input.userId },
      orderBy: { deletedAt: "desc" },
      select: { batchId: true, deletedAt: true, actorId: true, source: true },
    });
    const created = await tx.trashItem.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        recordType: input.recordType ?? null,
        itemId: input.itemId,
        title: input.title || "(tanpa judul)",
        batchId: chooseBatch(last, input.actorId, source, now, randomUUID),
        actorId: input.actorId,
        source,
        snapshot: input.snapshot ?? Prisma.JsonNull,
        deletedAt: now,
        expiresAt: trashExpiry(now),
      },
      select: { batchId: true },
    });
    return created.batchId;
  }

  /** Item yang hidup lagi lewat jalur lain (mis. record ditulis ulang) tidak lagi ada di Sampah. */
  forget(userId: string, kind: TrashKind, itemId: string, recordType?: string) {
    return this.prisma.trashItem.deleteMany({
      where: { userId, kind, itemId, ...(recordType ? { recordType } : {}) },
    });
  }

  list(user: AuthUser) {
    return this.prisma.trashItem.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
      select: LIST_SELECT,
      take: 1000,
    });
  }

  /** Pulihkan item terpilih atau satu kelompok. Berkas dipulihkan lebih dulu agar lampiran record langsung tersedia. */
  async restore(user: AuthUser, selector: { ids?: string[]; batchId?: string }) {
    const items = await this.select(user, selector);
    const ordered = [...items].sort((a, b) => Number(b.kind === "asset") - Number(a.kind === "asset"));
    const restored: string[] = [];
    const failed: { id: string; title: string; message: string }[] = [];
    for (const item of ordered) {
      try {
        await this.handler(item.kind).restore(item);
        await this.prisma.trashItem.delete({ where: { id: item.id } });
        restored.push(item.id);
      } catch (error) {
        failed.push({
          id: item.id,
          title: item.title,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { restored, failed };
  }

  /** Hapus permanen item terpilih, satu kelompok, atau seluruh Sampah (`all`). */
  async purge(user: AuthUser, selector: { ids?: string[]; batchId?: string; all?: boolean }) {
    const items = selector.all
      ? await this.prisma.trashItem.findMany({ where: { userId: user.id } })
      : await this.select(user, selector);
    let purged = 0;
    for (const item of items) if (await this.purgeOne(item)) purged += 1;
    return { purged };
  }

  /** Hapus permanen semua item yang masa simpannya habis. Galat dicatat, tidak pernah menjatuhkan proses. */
  async purgeExpired() {
    try {
      const items = await this.prisma.trashItem.findMany({
        where: { expiresAt: { lte: new Date() } },
        take: 500,
      });
      let purged = 0;
      for (const item of items) if (await this.purgeOne(item)) purged += 1;
      if (purged) this.logger.log(`Sampah: ${purged} item kedaluwarsa dihapus permanen.`);
    } catch (error) {
      this.logger.error(`Pembersihan Sampah gagal: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async purgeOne(item: TrashItem) {
    try {
      await this.handler(item.kind).purge(item);
      await this.prisma.trashItem.delete({ where: { id: item.id } });
      return true;
    } catch (error) {
      this.logger.warn(
        `Item Sampah ${item.id} gagal dihapus permanen: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private async select(user: AuthUser, selector: { ids?: string[]; batchId?: string }) {
    if (!selector.ids?.length && !selector.batchId) throw new NotFoundException("Pilih item yang akan diproses.");
    const items = await this.prisma.trashItem.findMany({
      where: {
        userId: user.id,
        ...(selector.batchId ? { batchId: selector.batchId } : { id: { in: selector.ids } }),
      },
    });
    if (!items.length) throw new NotFoundException("Item tidak ditemukan di Sampah.");
    return items;
  }

  private handler(kind: string) {
    const handler = this.handlers.get(kind as TrashKind);
    if (!handler) throw new Error(`Jenis item '${kind}' belum didukung Sampah.`);
    return handler;
  }
}
