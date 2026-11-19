import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { OAuthAccount } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { domainDelegate } from "../records/record-delegate";
import { rowToPayload } from "../records/record-mapper";
import { RECORD_TABLES, RECORD_TYPES } from "../records/record-schema";
import { ObjectStorageService } from "../storage/object-storage.service";
import {
  BACKUP_README,
  backupFileName,
  type BackupSettings,
  expiryDue,
  normalizeBackupSettings,
  runFolderName,
  runsToPrune,
  scheduleDue,
} from "./backup-logic";
import { DriveFolderMissingError, type DriveTarget, DriveUploadService } from "./drive-upload.service";
import { DriveService } from "./drive.service";

const MINUTE = 60_000;
const GOOGLE_ROOT = "Akasha Backup";
const ONEDRIVE_ROOT = "Backup";

export type BackupTrigger = "button" | "schedule" | "expiry";

export interface BackupProgress {
  phase: "data" | "files" | "finishing";
  done: number;
  total: number;
}

interface BackupStats {
  records: number;
  notebooks: number;
  requests: number;
  files: number;
  uploaded: number;
  reused: number;
  cold: number;
  skipped: number;
  bytes: number;
}

const message = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 300);

/**
 * Backup data Akasha ke Google Drive / OneDrive milik pemilik (tombol **Backup sekarang**, jadwal mingguan/bulanan, dan otomatis saat
 * masa akses hampir habis / sudah habis). Satu backup = folder "Backup <tanggal>" berisi `akasha-backup.json` (seluruh data) + README;
 * isi berkas disimpan sekali di folder "berkas" bersama dan dipakai ulang antar-backup (`drive_backup_files`). Berkas yang sedang di
 * arsip dingin tidak disalin ulang. Backup lebih lama dari `keep` dihapus. Berjalan di proses backend (satu backup per user sekaligus);
 * tetap boleh saat akun baca saja — justru untuk menyelamatkan data sebelum dihapus.
 */
@Injectable()
export class DriveBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriveBackupService.name);
  private timer?: NodeJS.Timeout;
  private readonly running = new Map<string, BackupProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly drive: DriveService,
    private readonly uploader: DriveUploadService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick().catch((error: unknown) => this.logger.warn(`Putaran backup gagal: ${message(error)}`)),
      30 * MINUTE,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------------------------------ pengaturan & status

  private async settings(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { driveBackup: true } });
    return normalizeBackupSettings(user?.driveBackup);
  }

  private async saveSettings(userId: string, settings: BackupSettings) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { driveBackup: settings as unknown as Prisma.InputJsonValue },
    });
  }

  async status(userId: string) {
    const [settings, accounts, runs, copies, user] = await Promise.all([
      this.settings(userId),
      this.drive.accounts(userId),
      this.prisma.driveBackup.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 10 }),
      this.prisma.driveBackupFile.aggregate({ where: { userId }, _count: true, _sum: { size: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { accessExpiresAt: true } }),
    ]);
    return {
      settings: { ...settings, rootFolderId: undefined, filesFolderId: undefined },
      accounts: accounts.accounts,
      running: this.running.get(userId) ?? null,
      runs: runs.map((r) => ({
        id: r.id,
        provider: r.provider,
        trigger: r.trigger,
        status: r.status,
        stats: r.stats,
        error: r.error,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
      stored: { files: copies._count, bytes: copies._sum.size ?? 0 },
      accessExpiresAt: user?.accessExpiresAt ?? null,
    };
  }

  async update(
    userId: string,
    input: Partial<Pick<BackupSettings, "accountId" | "schedule" | "keep" | "includeFiles" | "onExpiry">>,
  ) {
    const current = await this.settings(userId);
    const next = normalizeBackupSettings({ ...current, ...input });
    if (next.accountId && next.accountId !== current.accountId) {
      await this.drive.account(userId, next.accountId);
      next.rootFolderId = null;
      next.filesFolderId = null;
    }
    await this.saveSettings(userId, next);
    return this.status(userId);
  }

  // ------------------------------------------------------------------------------------------ menjalankan

  /** Backup sekarang (latar belakang). */
  async runNow(userId: string) {
    if (this.running.has(userId)) throw new ConflictException("Backup sedang berjalan.");
    const settings = await this.settings(userId);
    if (!settings.accountId) throw new BadRequestException("Pilih akun Google Drive / OneDrive tujuan backup dulu.");
    await this.drive.account(userId, settings.accountId);
    void this.run(userId, settings, "button");
    return this.status(userId);
  }

  /** Jadwal & masa akses: akun yang sudah memilih akun Drive. Akun baca saja tetap diproses (menyelamatkan data). */
  private async tick() {
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: { driveBackup: { path: ["accountId"], not: Prisma.AnyNull } },
      select: { id: true, driveBackup: true, accessExpiresAt: true },
    });
    for (const user of users) {
      if (this.running.has(user.id)) continue;
      const settings = normalizeBackupSettings(user.driveBackup);
      if (!settings.accountId) continue;
      const last = await this.prisma.driveBackup.findFirst({
        where: { userId: user.id, status: "done" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      // Gagal berulang tidak dicoba tiap 30 menit: tunggu 6 jam sejak percobaan terakhir
      const lastTry = await this.prisma.driveBackup.findFirst({
        where: { userId: user.id },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true },
      });
      if (lastTry?.status === "failed" && now.getTime() - lastTry.startedAt.getTime() < 6 * 60 * MINUTE) continue;
      const trigger: BackupTrigger | null =
        settings.onExpiry && expiryDue(user.accessExpiresAt, last?.startedAt ?? null, now)
          ? "expiry"
          : scheduleDue(settings.schedule, last?.startedAt ?? null, now)
            ? "schedule"
            : null;
      if (trigger) await this.run(user.id, settings, trigger);
    }
  }

  private async run(userId: string, settings: BackupSettings, trigger: BackupTrigger) {
    const progress: BackupProgress = { phase: "data", done: 0, total: 0 };
    this.running.set(userId, progress);
    const stats: BackupStats = {
      records: 0,
      notebooks: 0,
      requests: 0,
      files: 0,
      uploaded: 0,
      reused: 0,
      cold: 0,
      skipped: 0,
      bytes: 0,
    };
    let backupId: string | null = null;
    try {
      const account = await this.drive.account(userId, settings.accountId!);
      const row = await this.prisma.driveBackup.create({
        data: { userId, oauthAccountId: account.id, provider: account.provider, trigger, status: "running" },
      });
      backupId = row.id;
      const folders = await this.folders(userId, account, settings);
      const runTarget = await this.runTarget(account, folders, runFolderName(row.startedAt));

      const data = await this.collectData(userId, stats);
      progress.phase = "files";
      const files = settings.includeFiles
        ? await this.backupFiles(userId, account, folders.files, stats, progress)
        : [];

      progress.phase = "finishing";
      const manifest = {
        app: "akasha",
        format: 1,
        createdAt: row.startedAt.toISOString(),
        trigger,
        account:
          (await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })) ?? null,
        includeFiles: settings.includeFiles,
        ...data,
        files,
      };
      await this.uploader.uploadBuffer(
        account,
        runTarget.target,
        "akasha-backup.json",
        "application/json",
        Buffer.from(JSON.stringify(manifest, null, 1), "utf8"),
      );
      await this.uploader.uploadBuffer(
        account,
        runTarget.target,
        "README.txt",
        "text/plain",
        Buffer.from(BACKUP_README, "utf8"),
      );
      // OneDrive: folder backup dibuat otomatis oleh unggahan → ambil ID-nya agar bisa dipangkas nanti
      const folderId =
        runTarget.folderId ??
        (await this.uploader.oneDriveItemId(account, runTarget.target.onedriveFolder!).catch(() => null));
      await this.prisma.driveBackup.update({
        where: { id: row.id },
        data: {
          status: "done",
          folderId,
          stats: stats as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      await this.prune(userId, account, settings.keep).catch((error: unknown) =>
        this.logger.warn(`Pangkas backup lama gagal: ${message(error)}`),
      );
    } catch (error) {
      this.logger.warn(`Backup ${userId} gagal: ${message(error)}`);
      if (backupId)
        await this.prisma.driveBackup
          .update({
            where: { id: backupId },
            data: {
              status: "failed",
              error: message(error),
              stats: stats as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
    } finally {
      this.running.delete(userId);
    }
  }

  /** Folder induk & folder "berkas" (Google: dibuat sekali, dicek masih ada; OneDrive: path di folder aplikasi). */
  private async folders(userId: string, account: OAuthAccount, settings: BackupSettings) {
    if (account.provider !== "google")
      return { root: { onedriveFolder: ONEDRIVE_ROOT }, files: { onedriveFolder: `${ONEDRIVE_ROOT}/berkas` } };
    let { rootFolderId, filesFolderId } = settings;
    if (!rootFolderId || !(await this.uploader.exists(account, rootFolderId))) {
      // Folder dihapus pemilik dari Drive → salinan berkas lama ikut hilang, unggah ulang semua
      await this.prisma.driveBackupFile.deleteMany({ where: { oauthAccountId: account.id } });
      rootFolderId = await this.uploader.createGoogleFolder(account, GOOGLE_ROOT);
      filesFolderId = null;
    }
    if (!filesFolderId || !(await this.uploader.exists(account, filesFolderId))) {
      await this.prisma.driveBackupFile.deleteMany({ where: { oauthAccountId: account.id } });
      filesFolderId = await this.uploader.createGoogleFolder(account, "berkas", rootFolderId);
    }
    const latest = await this.settings(userId);
    if (latest.accountId === account.id) await this.saveSettings(userId, { ...latest, rootFolderId, filesFolderId });
    return { root: { googleFolderId: rootFolderId }, files: { googleFolderId: filesFolderId } };
  }

  private async runTarget(account: OAuthAccount, folders: { root: DriveTarget }, name: string) {
    if (account.provider === "google") {
      const folderId = await this.uploader.createGoogleFolder(account, name, folders.root.googleFolderId);
      return { folderId, target: { googleFolderId: folderId } as DriveTarget };
    }
    return { folderId: null, target: { onedriveFolder: `${ONEDRIVE_ROOT}/${name}` } as DriveTarget };
  }

  /** Seluruh data kerja milik user (bukan item yang dibagikan orang lain), My Notebook, Pengajuan, percakapan AI Agent. */
  private async collectData(userId: string, stats: BackupStats) {
    const records: Record<string, unknown[]> = {};
    for (const type of RECORD_TYPES) {
      const rows = await domainDelegate(this.prisma, type).findMany({ where: { userId, deletedAt: null } });
      if (!rows.length) continue;
      records[type] = rows.map((row) => rowToPayload(RECORD_TABLES[type], row));
      stats.records += rows.length;
    }
    const notebooks = await this.prisma.notebook.findMany({
      where: { userId },
      include: { sources: true, notes: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    const requests = await this.prisma.request.findMany({ where: { userId } });
    const convertedDocuments = await this.prisma.convertedDocument.findMany({
      where: { userId, status: "done" },
      select: { id: true, title: true, fileName: true, markdown: true, enhancedMarkdown: true, createdAt: true },
    });
    const agentConversations = await this.prisma.agentConversation.findMany({
      where: { userId, deletedAt: null },
      include: {
        runs: { select: { input: true, output: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    });
    stats.notebooks = notebooks.length;
    stats.requests = requests.length;
    return { records, notebooks, requests, convertedDocuments, agentConversations };
  }

  /**
   * Berkas milik user: yang sudah tersalin (akun + checksum sama) dipakai ulang, yang di arsip dingin dicatat lokasinya, sisanya diunggah
   * ke folder "berkas". Membaca dari storage tanpa mengubah "terakhir dibuka" (tidak menggagalkan arsip dingin).
   */
  private async backupFiles(
    userId: string,
    account: OAuthAccount,
    target: DriveTarget,
    stats: BackupStats,
    progress: BackupProgress,
  ) {
    const assets = await this.prisma.asset.findMany({
      where: { userId },
      select: {
        id: true,
        objectKey: true,
        originalName: true,
        mimeType: true,
        size: true,
        checksum: true,
        context: true,
      },
      orderBy: { createdAt: "asc" },
    });
    progress.total = assets.length;
    const cold = new Map(
      (
        await this.prisma.coldObject.findMany({
          where: { userId },
          select: { objectKey: true, provider: true, fileId: true },
        })
      ).map((c) => [c.objectKey, c]),
    );
    const now = new Date();
    const list: unknown[] = [];
    let failedInRow = 0;
    for (const asset of assets) {
      progress.done++;
      stats.files++;
      const base = {
        assetId: asset.id,
        name: asset.originalName,
        mimeType: asset.mimeType,
        size: asset.size,
        checksum: asset.checksum,
        context: asset.context,
      };
      const coldCopy = cold.get(asset.objectKey);
      if (coldCopy) {
        stats.cold++;
        list.push({ ...base, cold: true, provider: coldCopy.provider, driveFileId: coldCopy.fileId });
        continue;
      }
      const existing = await this.prisma.driveBackupFile.findUnique({
        where: { oauthAccountId_checksum: { oauthAccountId: account.id, checksum: asset.checksum } },
      });
      if (existing) {
        stats.reused++;
        await this.prisma.driveBackupFile.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
        list.push({ ...base, driveFileId: existing.fileId, driveName: existing.name });
        continue;
      }
      try {
        const name = backupFileName(asset.checksum, asset.originalName);
        const url = await this.uploader.createSession(account, target, {
          name,
          mimeType: asset.mimeType,
          size: asset.size,
          appProperty: "backup",
        });
        const fileId = await this.uploader.upload(
          account.provider,
          url,
          await this.storage.getObjectRaw(asset.objectKey),
          asset.size,
        );
        await this.prisma.driveBackupFile.upsert({
          where: { oauthAccountId_checksum: { oauthAccountId: account.id, checksum: asset.checksum } },
          create: {
            userId,
            oauthAccountId: account.id,
            checksum: asset.checksum,
            fileId,
            name,
            size: asset.size,
            lastSeenAt: now,
          },
          update: { fileId, name, size: asset.size, lastSeenAt: now },
        });
        stats.uploaded++;
        stats.bytes += asset.size;
        list.push({ ...base, driveFileId: fileId, driveName: name });
        failedInRow = 0;
      } catch (error) {
        if (error instanceof DriveFolderMissingError) throw error;
        stats.skipped++;
        list.push({ ...base, error: message(error) });
        this.logger.warn(`Backup berkas ${asset.id} gagal: ${message(error)}`);
        // Akun / kuota bermasalah → hentikan, laporkan
        if (++failedInRow >= 5)
          throw new Error(`Lima berkas berturut-turut gagal diunggah: ${message(error)}`, { cause: error });
      }
    }
    return list;
  }

  /** Simpan `keep` backup berhasil terbaru; folder lebih lama & berkas yang tidak lagi dipakai backup tersisa dihapus dari Drive. */
  private async prune(userId: string, account: OAuthAccount, keep: number) {
    const runs = await this.prisma.driveBackup.findMany({
      where: { userId, oauthAccountId: account.id },
      orderBy: { startedAt: "desc" },
    });
    for (const old of runsToPrune(runs, keep)) {
      if (old.folderId) await this.uploader.deleteRemote(account, old.folderId).catch(() => undefined);
      await this.prisma.driveBackup.delete({ where: { id: old.id } });
    }
    const kept = runs.filter((r) => r.status === "done").slice(0, keep);
    const oldest = kept.at(-1);
    if (!oldest) return;
    const stale = await this.prisma.driveBackupFile.findMany({
      where: { oauthAccountId: account.id, lastSeenAt: { lt: oldest.startedAt } },
    });
    for (const file of stale) {
      await this.uploader.deleteRemote(account, file.fileId).catch(() => undefined);
      await this.prisma.driveBackupFile.delete({ where: { id: file.id } });
    }
  }
}
