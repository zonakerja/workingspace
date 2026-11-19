import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import type { OAuthAccount } from "../generated/prisma/client";
import type { OAuthProvider } from "../connections/oauth-logic";
import { OAuthService } from "../connections/oauth.service";
import { contentRange, UPLOAD_CHUNK } from "./drive-logic";
import { DriveService } from "./drive.service";

/** Tujuan unggahan: Google = folder (ID), OneDrive = path di folder aplikasi (`approot:/…`). */
export interface DriveTarget {
  googleFolderId?: string;
  /** Path folder OneDrive relatif terhadap folder aplikasi, mis. "Backup/berkas" */
  onedriveFolder?: string;
}

export class DriveFolderMissingError extends Error {}

/**
 * Unggah ke Google Drive (izin drive.file) / OneDrive (folder aplikasi): folder, sesi unggahan bertahap 10 MiB, hapus, cek ada.
 * Dipakai bersama arsip dingin (docs/AKUN-TERSAMBUNG.md tahap 4b) dan backup ke Drive.
 */
@Injectable()
export class DriveUploadService {
  constructor(
    private readonly oauth: OAuthService,
    private readonly drive: DriveService,
  ) {}

  private base(account: OAuthAccount) {
    return this.oauth.endpoints(account.provider as OAuthProvider);
  }

  /** Buat folder Google Drive (opsional di dalam folder lain). */
  async createGoogleFolder(account: OAuthAccount, name: string, parentId?: string) {
    const { data } = await this.oauth.api<{ id?: string }>(account, `${this.base(account).drive}/files?fields=id`, {
      method: "POST",
      body: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
    });
    if (!data?.id) throw new Error(`Folder "${name}" di Google Drive gagal dibuat.`);
    return data.id;
  }

  /** Berkas/folder masih ada (Google: tidak di tempat sampah)? */
  async exists(account: OAuthAccount, fileId: string) {
    const url =
      account.provider === "google"
        ? `${this.base(account).drive}/files/${encodeURIComponent(fileId)}?fields=id,trashed`
        : `${this.base(account).drive}/me/drive/items/${encodeURIComponent(fileId)}?$select=id`;
    const { data, status } = await this.oauth.api<{ id?: string; trashed?: boolean }>(account, url, { allow: [404] });
    return status !== 404 && !!data?.id && !data.trashed;
  }

  /** Sesi unggahan bertahap (Google resumable / OneDrive createUploadSession). Mengembalikan alamat sesi. */
  async createSession(
    account: OAuthAccount,
    target: DriveTarget,
    file: { name: string; mimeType: string; size: number; appProperty?: string },
  ) {
    const endpoints = this.base(account);
    if (account.provider === "google") {
      if (!target.googleFolderId) throw new Error("Folder Google Drive tujuan belum ada.");
      const res = await this.drive.fetchRaw(
        account,
        `${endpoints.driveUpload}/files?uploadType=resumable&fields=id`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-type": file.mimeType || "application/octet-stream",
            "x-upload-content-length": String(file.size),
          },
          body: JSON.stringify({
            name: file.name,
            parents: [target.googleFolderId],
            ...(file.appProperty ? { appProperties: { akasha: file.appProperty } } : {}),
          }),
        },
        60_000,
      );
      const location = res.headers.get("location");
      if (!res.ok || !location) {
        const text = (await res.text()).slice(0, 200);
        if (res.status === 404)
          throw new DriveFolderMissingError(`Folder tujuan di Google Drive tidak ditemukan: ${text}`);
        throw new Error(`Google Drive menolak unggahan (status ${res.status}): ${text}`);
      }
      return location;
    }
    const path = [...(target.onedriveFolder ?? "").split("/").filter(Boolean), file.name]
      .map(encodeURIComponent)
      .join("/");
    const { data } = await this.oauth.api<{ uploadUrl?: string }>(
      account,
      `${endpoints.drive}/me/drive/special/approot:/${path}:/createUploadSession`,
      { method: "POST", body: { item: { "@microsoft.graph.conflictBehavior": "rename" } } },
    );
    if (!data?.uploadUrl) throw new Error("OneDrive tidak memberi alamat unggahan.");
    return data.uploadUrl;
  }

  /** Unggah isi per potongan 10 MiB ke alamat sesi (tanpa token: alamat sesi = izinnya). Mengembalikan ID berkas. */
  async upload(provider: string, url: string, stream: Readable, total: number) {
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

  /** Unggah isi kecil yang sudah di memori (manifest backup, README). */
  async uploadBuffer(account: OAuthAccount, target: DriveTarget, name: string, mimeType: string, body: Buffer) {
    const url = await this.createSession(account, target, { name, mimeType, size: body.length });
    return this.upload(account.provider, url, Readable.from([body]), body.length);
  }

  /** ID item OneDrive dari path di folder aplikasi (null = tidak ada). */
  async oneDriveItemId(account: OAuthAccount, path: string) {
    const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const { data, status } = await this.oauth.api<{ id?: string }>(
      account,
      `${this.base(account).drive}/me/drive/special/approot:/${encoded}`,
      { allow: [404] },
    );
    return status === 404 ? null : (data?.id ?? null);
  }

  async deleteRemote(account: OAuthAccount, fileId: string) {
    const base = this.base(account).drive;
    const url =
      account.provider === "google"
        ? `${base}/files/${encodeURIComponent(fileId)}`
        : `${base}/me/drive/items/${encodeURIComponent(fileId)}`;
    await this.oauth.api(account, url, { method: "DELETE", allow: [404] });
  }
}
