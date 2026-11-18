import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { OAuthAccount } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { hasDriveScope, type OAuthProvider } from "../connections/oauth-logic";
import { OAuthService } from "../connections/oauth.service";
import { PrismaService } from "../prisma/prisma.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import {
  COLD_EXCLUDED_CONTEXTS,
  coldCutoff,
  coldFileName,
  coldMinBytes,
  type ColdStorageSettings,
  contentRange,
  normalizeColdSettings,
  pickColdBatch,
  UPLOAD_CHUNK,
} from "./drive-logic";
import { DriveService } from "./drive.service";

const HOUR = 60 * 60_000;
const TOUCH_EVERY_MS = 6 * HOUR;
const GOOGLE_FOLDER_NAME = "Akasha Arsip";
const ONEDRIVE_FOLDER = "Arsip dingin";

interface Candidate {
  id: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
}

export interface RunResult {
  kind: "move" | "restore";
  at: string;
  done: number;
  failed: number;
  bytes: number;
  error: string | null;
}

const message = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 300);

/**
 * Arsip dingin (docs/AKUN-TERSAMBUNG.md tahap 4b): berkas yang lama tidak dibuka dipindah dari object storage ke Google Drive
 * (folder "Akasha Arsip", izin drive.file) / OneDrive (folder aplikasi). Akasha menyimpan metadata di `cold_objects`; saat fitur
 * mana pun membaca objeknya, ObjectStorageService memanggil `restore` sehingga berkas kembali ke storage lalu dibaca seperti biasa.
 * Pemindahan per user diserialkan (satu putaran sekaligus), status putaran di memori satu proses.
 */
@Injectable()
export class ColdStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ColdStorageService.name);
  private timer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;
  private readonly restoring = new Map<string, Promise<boolean>>();
  private readonly touchedAt = new Map<string, number>();
  private readonly state = new Map<string, { running: "move" | "restore" | null; lastRun: RunResult | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly oauth: OAuthService,
    private readonly drive: DriveService,
  ) {}

  onModuleInit() {
    this.storage.setColdStorageHooks({
      restore: (key) => this.restore(key),
      removed: (key) => this.forget(key),
      touched: (key) => this.touch(key),
    });
    const safeTick = () =>
      void this.tick().catch((error: unknown) => this.logger.warn(`Putaran arsip dingin gagal: ${message(error)}`));
    this.firstRun = setTimeout(safeTick, 2 * 60_000);
    this.timer = setInterval(safeTick, HOUR);
  }

  onModuleDestroy() {
    clearTimeout(this.firstRun);
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------------------------------ pengaturan & status

  private async settings(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coldStorage: true } });
    return normalizeColdSettings(user?.coldStorage);
  }

  private async saveSettings(userId: string, settings: ColdStorageSettings) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { coldStorage: settings as unknown as Prisma.InputJsonValue },
    });
  }

  private runState(userId: string) {
    let s = this.state.get(userId);
    if (!s) this.state.set(userId, (s = { running: null, lastRun: null }));
    return s;
  }

  async status(userId: string) {
    const settings = await this.settings(userId);
    const [stored, candidates, accounts] = await Promise.all([
      this.prisma.coldObject.aggregate({ where: { userId }, _count: true, _sum: { size: true } }),
      this.candidates(userId, settings, 5000),
      this.drive.accounts(userId),
    ]);
    const { running, lastRun } = this.runState(userId);
    return {
      settings: { ...settings, folderId: undefined },
      accounts: accounts.accounts,
      stored: { count: stored._count, bytes: stored._sum.size ?? 0 },
      candidates: { count: candidates.length, bytes: candidates.reduce((sum, c) => sum + c.size, 0) },
      running,
      lastRun,
    };
  }

  async update(
    userId: string,
    input: { enabled?: boolean; accountId?: string | null; afterDays?: number; minSizeMb?: number },
  ) {
    const current = await this.settings(userId);
    const next = normalizeColdSettings({ ...current, ...input });
    if (next.accountId && next.accountId !== current.accountId) {
      await this.drive.account(userId, next.accountId);
      next.folderId = null;
    }
    if (next.enabled && !next.accountId) throw new BadRequestException("Pilih akun Drive tempat berkas dipindah.");
    await this.saveSettings(userId, next);
    return this.status(userId);
  }

  /** Kandidat pemindahan, terlama dibuka dulu. Berkas bertautan publik / di brankas tidak pernah dipindah (dibuka orang lain). */
  private async candidates(userId: string, settings: ColdStorageSettings, limit: number): Promise<Candidate[]> {
    const cutoff = coldCutoff(settings, new Date());
    return this.prisma.$queryRaw<Candidate[]>`
      SELECT a.id, a.object_key AS "objectKey", a.original_name AS "originalName", a.mime_type AS "mimeType", a.size, a.checksum
      FROM assets a
      WHERE a.user_id = ${userId}
        AND a.size >= ${coldMinBytes(settings)}
        AND COALESCE(a.last_accessed_at, a.created_at) < ${cutoff}
        AND (a.context IS NULL OR NOT (a.context = ANY(${COLD_EXCLUDED_CONTEXTS}::text[])))
        AND NOT EXISTS (SELECT 1 FROM cold_objects c WHERE c.object_key = a.object_key)
        AND NOT EXISTS (
          SELECT 1 FROM public_links p WHERE p.asset_id = a.id AND (p.expires_at IS NULL OR p.expires_at > now())
        )
        AND NOT EXISTS (SELECT 1 FROM public_vault_files v WHERE v.asset_id = a.id)
      ORDER BY COALESCE(a.last_accessed_at, a.created_at) ASC
      LIMIT ${limit}`;
  }

  // ------------------------------------------------------------------------------------------ pemindahan

  /** Jalankan satu putaran sekarang (latar belakang). */
  async runNow(userId: string) {
    if (this.runState(userId).running) throw new ConflictException("Arsip dingin sedang berjalan.");
    const settings = await this.settings(userId);
    if (!settings.accountId) throw new BadRequestException("Pilih akun Drive dulu.");
    await this.drive.account(userId, settings.accountId);
    void this.moveFor(userId, settings);
    return this.status(userId);
  }

  private async tick() {
    const users = await this.prisma.user.findMany({
      where: { coldStorage: { path: ["enabled"], equals: true } },
      select: { id: true, coldStorage: true },
    });
    for (const user of users) {
      if (this.runState(user.id).running) continue;
      await this.moveFor(user.id, normalizeColdSettings(user.coldStorage));
    }
  }

  private async moveFor(userId: string, settings: ColdStorageSettings) {
    const state = this.runState(userId);
    state.running = "move";
    const result: RunResult = { kind: "move", at: new Date().toISOString(), done: 0, failed: 0, bytes: 0, error: null };
    try {
      if (!settings.accountId) throw new Error("Akun Drive belum dipilih.");
      const account = await this.oauth.own(userId, settings.accountId);
      if (!hasDriveScope(account.provider as OAuthProvider, account.scopes))
        throw new Error("Izin Drive akun ini tidak ada lagi. Izinkan Drive ulang.");
      const batch = pickColdBatch(await this.candidates(userId, settings, 200));
      let failedInRow = 0;
      for (const asset of batch) {
        try {
          if (await this.moveOne(userId, account, settings, asset)) {
            result.done++;
            result.bytes += asset.size;
          }
          failedInRow = 0;
        } catch (error) {
          result.failed++;
          result.error = `${asset.originalName}: ${message(error)}`;
          this.logger.warn(`Arsip dingin ${asset.objectKey} gagal: ${message(error)}`);
          if (++failedInRow >= 3) break; // akun / kuota bermasalah → jangan habiskan putaran
        }
      }
    } catch (error) {
      result.error = message(error);
    } finally {
      state.running = null;
      state.lastRun = result;
    }
  }

  /** Pindahkan satu objek. false = dibatalkan karena berkas berubah / dibuka / dihapus selama diunggah. */
  private async moveOne(userId: string, account: OAuthAccount, settings: ColdStorageSettings, asset: Candidate) {
    const name = coldFileName(asset.objectKey, asset.originalName);
    const sessionUrl = await this.createUploadSession(userId, account, settings, name, asset);
    const fileId = await this.uploadChunks(
      account.provider,
      sessionUrl,
      await this.storage.getObjectRaw(asset.objectKey),
      asset.size,
    );
    const cutoff = coldCutoff(settings, new Date());
    const unchanged = await this.prisma.asset.findFirst({
      where: {
        id: asset.id,
        objectKey: asset.objectKey,
        checksum: asset.checksum,
        OR: [{ lastAccessedAt: null }, { lastAccessedAt: { lt: cutoff } }],
      },
      select: { id: true },
    });
    if (!unchanged) {
      await this.deleteRemote(account, fileId).catch(() => undefined);
      return false;
    }
    await this.prisma.coldObject.create({
      data: {
        objectKey: asset.objectKey,
        userId,
        oauthAccountId: account.id,
        provider: account.provider,
        fileId,
        size: asset.size,
        mimeType: asset.mimeType,
        checksum: asset.checksum,
      },
    });
    await this.storage.deleteObject(asset.objectKey, { keepCold: true });
    return true;
  }

  private async googleFolder(userId: string, account: OAuthAccount, settings: ColdStorageSettings) {
    if (settings.folderId) return settings.folderId;
    const { data } = await this.oauth.api<{ id?: string }>(
      account,
      `${this.oauth.endpoints("google").drive}/files?fields=id`,
      {
        method: "POST",
        body: { name: GOOGLE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
      },
    );
    if (!data?.id) throw new Error("Folder arsip di Google Drive gagal dibuat.");
    settings.folderId = data.id;
    const latest = await this.settings(userId);
    if (latest.accountId === account.id) await this.saveSettings(userId, { ...latest, folderId: data.id });
    return data.id;
  }

  /** Sesi unggahan bertahap (Google resumable / OneDrive createUploadSession). Mengembalikan alamat sesi. */
  private async createUploadSession(
    userId: string,
    account: OAuthAccount,
    settings: ColdStorageSettings,
    name: string,
    asset: Candidate,
  ) {
    const endpoints = this.oauth.endpoints(account.provider as OAuthProvider);
    if (account.provider === "google") {
      const folderId = await this.googleFolder(userId, account, settings);
      const res = await this.drive.fetchRaw(
        account,
        `${endpoints.driveUpload}/files?uploadType=resumable&fields=id`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-type": asset.mimeType || "application/octet-stream",
            "x-upload-content-length": String(asset.size),
          },
          body: JSON.stringify({ name, parents: [folderId], appProperties: { akasha: "arsip-dingin" } }),
        },
        60_000,
      );
      const location = res.headers.get("location");
      if (!res.ok || !location) {
        if (res.status === 404) await this.saveSettings(userId, { ...settings, folderId: null }); // folder dihapus user
        throw new Error(`Google Drive menolak unggahan (status ${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      return location;
    }
    const path = [ONEDRIVE_FOLDER, name].map(encodeURIComponent).join("/");
    const { data } = await this.oauth.api<{ uploadUrl?: string }>(
      account,
      `${endpoints.drive}/me/drive/special/approot:/${path}:/createUploadSession`,
      { method: "POST", body: { item: { "@microsoft.graph.conflictBehavior": "rename" } } },
    );
    if (!data?.uploadUrl) throw new Error("OneDrive tidak memberi alamat unggahan.");
    return data.uploadUrl;
  }

  /** Unggah isi objek per potongan 10 MiB ke alamat sesi (tanpa token: alamat sesi = izinnya). Mengembalikan ID berkas. */
  private async uploadChunks(provider: string, url: string, stream: Readable, total: number) {
    let sent = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    const put = async (chunk: Buffer) => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-length": String(chunk.length), "content-range": contentRange(sent, chunk.length, total) },
        body: new Uint8Array(chunk),
        signal: AbortSignal.timeout(5 * 60_000),
      });
      sent += chunk.length;
      const last = sent >= total;
      // Google: 308 = lanjut; OneDrive: 202 = lanjut; keduanya 200/201 + JSON berkas di potongan terakhir
      if (!last && (res.status === 308 || res.status === 202)) {
        await res.arrayBuffer().catch(() => undefined);
        return null;
      }
      const text = await res.text();
      if (!res.ok || !last) throw new Error(`Unggahan ${provider} gagal (status ${res.status}): ${text.slice(0, 200)}`);
      const id = (JSON.parse(text || "{}") as { id?: string }).id;
      if (!id) throw new Error("Penyedia tidak mengembalikan ID berkas.");
      return id;
    };
    for await (const part of stream) {
      const buf = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
      pending.push(buf);
      pendingBytes += buf.length;
      while (pendingBytes >= UPLOAD_CHUNK && sent + UPLOAD_CHUNK < total) {
        const all = Buffer.concat(pending);
        await put(all.subarray(0, UPLOAD_CHUNK));
        pending = [all.subarray(UPLOAD_CHUNK)];
        pendingBytes = pending[0].length;
      }
    }
    if (sent + pendingBytes !== total) throw new Error("Ukuran berkas di storage tidak sama dengan catatan Akasha.");
    const id = await put(Buffer.concat(pending));
    if (!id) throw new Error("Unggahan belum selesai.");
    return id;
  }

  private async deleteRemote(account: OAuthAccount, fileId: string) {
    const base = this.oauth.endpoints(account.provider as OAuthProvider).drive;
    const url =
      account.provider === "google"
        ? `${base}/files/${encodeURIComponent(fileId)}`
        : `${base}/me/drive/items/${encodeURIComponent(fileId)}`;
    await this.oauth.api(account, url, { method: "DELETE", allow: [404] });
  }

  // ------------------------------------------------------------------------------------------ pengambilan kembali

  /** Pengait ObjectStorageService: objek tidak ada di bucket → kembalikan dari Drive (sekali per key walau dibaca bersamaan). */
  restore(key: string): Promise<boolean> {
    const running = this.restoring.get(key);
    if (running) return running;
    const job = this.doRestore(key).finally(() => this.restoring.delete(key));
    this.restoring.set(key, job);
    return job;
  }

  private async doRestore(key: string) {
    const row = await this.prisma.coldObject.findUnique({ where: { objectKey: key }, include: { oauthAccount: true } });
    if (!row) return false;
    const account = row.oauthAccount;
    const base = this.oauth.endpoints(account.provider as OAuthProvider).drive;
    const url =
      account.provider === "google"
        ? `${base}/files/${encodeURIComponent(row.fileId)}?alt=media`
        : `${base}/me/drive/items/${encodeURIComponent(row.fileId)}/content`;
    const label = account.provider === "google" ? "Google Drive" : "OneDrive";
    let res: Response;
    try {
      res = await this.drive.fetchRaw(account, url);
    } catch (error) {
      throw new UnprocessableEntityException(
        `Berkas ada di arsip dingin (${label}) dan gagal diambil: ${message(error)}`,
      );
    }
    if (!res.ok || !res.body)
      throw new UnprocessableEntityException(
        res.status === 404
          ? `Berkas arsip dingin tidak ditemukan lagi di ${label} (${account.email}). Mungkin dihapus dari Drive.`
          : `Berkas ada di arsip dingin (${label}) dan gagal diambil (status ${res.status}). Periksa akun di Pengaturan → Akun Tersambung.`,
      );
    const length = Number(res.headers.get("content-length")) || row.size;
    await this.storage.putObject({
      key,
      body: Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      contentLength: length,
      contentType: row.mimeType,
      checksum: row.checksum,
    });
    await this.prisma.coldObject.delete({ where: { id: row.id } });
    // Baru dibuka → tidak langsung dipindah lagi pada putaran berikutnya
    await this.prisma.asset.updateMany({ where: { objectKey: key }, data: { lastAccessedAt: new Date() } });
    this.touchedAt.set(key, Date.now());
    await this.deleteRemote(account, row.fileId).catch((error: unknown) =>
      this.logger.warn(`Salinan Drive ${row.fileId} tidak terhapus setelah dikembalikan: ${message(error)}`),
    );
    return true;
  }

  /** Pengait hapus objek: salinan di Drive ikut dihapus. */
  private async forget(key: string) {
    const row = await this.prisma.coldObject.findUnique({ where: { objectKey: key }, include: { oauthAccount: true } });
    if (!row) return;
    await this.deleteRemote(row.oauthAccount, row.fileId).catch((error: unknown) =>
      this.logger.warn(`Salinan Drive ${row.fileId} gagal dihapus: ${message(error)}`),
    );
    await this.prisma.coldObject.delete({ where: { id: row.id } }).catch(() => undefined);
  }

  /** Pengait baca objek: catat "terakhir dibuka" paling sering sekali per 6 jam per objek. */
  private touch(key: string) {
    const now = Date.now();
    const last = this.touchedAt.get(key);
    if (last && now - last < TOUCH_EVERY_MS) return;
    if (this.touchedAt.size > 5000) this.touchedAt.clear();
    this.touchedAt.set(key, now);
    void this.prisma.asset
      .updateMany({ where: { objectKey: key }, data: { lastAccessedAt: new Date(now) } })
      .catch(() => undefined);
  }

  /** Kembalikan semua berkas arsip dingin user ke storage (latar belakang) dan matikan pemindahan otomatis. */
  async restoreAll(userId: string) {
    const state = this.runState(userId);
    if (state.running) throw new ConflictException("Arsip dingin sedang berjalan.");
    const settings = await this.settings(userId);
    await this.saveSettings(userId, { ...settings, enabled: false });
    state.running = "restore";
    void (async () => {
      const result: RunResult = {
        kind: "restore",
        at: new Date().toISOString(),
        done: 0,
        failed: 0,
        bytes: 0,
        error: null,
      };
      try {
        const rows = await this.prisma.coldObject.findMany({ where: { userId }, orderBy: { movedAt: "desc" } });
        for (const row of rows) {
          try {
            if (await this.restore(row.objectKey)) {
              result.done++;
              result.bytes += row.size;
            }
          } catch (error) {
            result.failed++;
            result.error = message(error);
          }
        }
      } catch (error) {
        result.error = message(error);
      } finally {
        state.running = null;
        state.lastRun = result;
      }
    })();
    return this.status(userId);
  }
}
