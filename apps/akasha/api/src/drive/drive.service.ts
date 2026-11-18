import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { OAuthAccount } from "../generated/prisma/client";
import { hasDriveScope, type OAuthProvider } from "../connections/oauth-logic";
import { OAuthService, ProviderError } from "../connections/oauth.service";
import { type DriveItem, fromGoogleFile, fromGraphItem, sortDriveItems } from "./drive-logic";

const GRAPH_SELECT = "id,name,size,file,folder,lastModifiedDateTime,parentReference";
const providerLabel = (p: string) => (p === "google" ? "Google Drive" : "OneDrive");

/**
 * Memilih berkas dari Google Drive / OneDrive (docs/AKUN-TERSAMBUNG.md tahap 4a). Berkas dialirkan ke browser lalu diunggah lewat
 * jalur unggah form biasa, sehingga aturan form (Ringkas AI, File Control, buang saat batal) tetap sama. Google memakai Picker
 * resmi (izin `drive.file`): server hanya bisa membaca berkas yang dipilih user di Picker.
 */
@Injectable()
export class DriveService {
  private readonly maxBytes: number;
  private readonly picker: { apiKey?: string; appId?: string };

  constructor(
    private readonly oauth: OAuthService,
    config: ConfigService,
  ) {
    this.maxBytes = Number(config.get("UPLOAD_MAX_MB") ?? 300) * 1024 * 1024;
    this.picker = {
      apiKey: config.get<string>("GOOGLE_PICKER_API_KEY") || undefined,
      appId: config.get<string>("GOOGLE_PICKER_APP_ID") || undefined,
    };
  }

  get pickerReady() {
    return !!(this.picker.apiKey && this.picker.appId);
  }

  /** Akun tersambung yang sudah memberi izin Drive. */
  async accounts(userId: string) {
    const accounts = await this.oauth.list(userId);
    return {
      pickerReady: this.pickerReady,
      maxMb: Math.round(this.maxBytes / 1024 / 1024),
      accounts: accounts
        .filter((a) => hasDriveScope(a.provider as OAuthProvider, a.scopes))
        .map((a) => ({ id: a.id, provider: a.provider, email: a.email, status: a.status })),
    };
  }

  /** Akun milik user dengan izin Drive yang masih berlaku. */
  async account(userId: string, id: string) {
    const account = await this.oauth.own(userId, id);
    if (!hasDriveScope(account.provider as OAuthProvider, account.scopes))
      throw new BadRequestException("Izinkan Drive untuk akun ini dulu (Pengaturan → Akun Tersambung).");
    if (account.status === "error")
      throw new BadRequestException(account.statusMessage ?? "Akun perlu disambungkan ulang.");
    return account;
  }

  /** Bekal Google Picker di browser: token akses akun (izin kalender Akasha + drive.file saja), API key, nomor project. */
  async pickerConfig(userId: string, id: string) {
    const account = await this.account(userId, id);
    if (account.provider !== "google") throw new BadRequestException("Picker hanya untuk Google Drive.");
    if (!this.pickerReady)
      throw new BadRequestException(
        "Picker Google belum diatur di server (GOOGLE_PICKER_API_KEY / GOOGLE_PICKER_APP_ID).",
      );
    return {
      accessToken: await this.oauth.accessToken(account),
      apiKey: this.picker.apiKey!,
      appId: this.picker.appId!,
    };
  }

  /** Isi folder / hasil cari OneDrive. Google Drive tidak bisa dijelajahi server (izin drive.file) → Picker. */
  async list(userId: string, id: string, input: { folder?: string; q?: string }) {
    const account = await this.account(userId, id);
    if (account.provider !== "microsoft")
      throw new BadRequestException("Google Drive dipilih lewat jendela pemilih Google, bukan daftar ini.");
    const base = this.oauth.endpoints("microsoft").drive;
    const q = input.q?.trim();
    const url = q
      ? `${base}/me/drive/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?$top=100&$select=${GRAPH_SELECT}`
      : input.folder
        ? `${base}/me/drive/items/${encodeURIComponent(input.folder)}/children?$top=200&$select=${GRAPH_SELECT}`
        : `${base}/me/drive/root/children?$top=200&$select=${GRAPH_SELECT}`;
    const { data } = await this.oauth.api<{ value?: unknown[] }>(account, url);
    const items = sortDriveItems((data?.value ?? []).map(fromGraphItem).filter((x): x is DriveItem => !!x));
    let folder: { id: string; name: string; parentId: string | null } | null = null;
    if (input.folder && !q) {
      const { data: meta } = await this.oauth.api<{
        id?: string;
        name?: string;
        parentReference?: { id?: string; path?: string };
      }>(account, `${base}/me/drive/items/${encodeURIComponent(input.folder)}?$select=id,name,parentReference`);
      const atRoot = !meta?.parentReference?.path || /\/root:?$/.test(meta.parentReference.path);
      folder = {
        id: meta?.id ?? input.folder,
        name: meta?.name ?? "",
        parentId: atRoot ? null : (meta?.parentReference?.id ?? null),
      };
    }
    return { folder, items };
  }

  /** Buka berkas untuk dialirkan ke browser. Ukuran dibatasi UPLOAD_MAX_MB (juga saat dialirkan bila ukuran belum diketahui). */
  async open(userId: string, id: string, fileId: string) {
    const account = await this.account(userId, id);
    const endpoints = this.oauth.endpoints(account.provider as OAuthProvider);
    let item: DriveItem | null;
    let url: string;
    if (account.provider === "google") {
      const { data } = await this.oauth.api(
        account,
        `${endpoints.drive}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`,
      );
      item = fromGoogleFile(data);
      url = item?.exportMime
        ? `${endpoints.drive}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(item.exportMime)}`
        : `${endpoints.drive}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    } else {
      const { data } = await this.oauth.api(
        account,
        `${endpoints.drive}/me/drive/items/${encodeURIComponent(fileId)}?$select=${GRAPH_SELECT}`,
      );
      item = fromGraphItem(data);
      url = `${endpoints.drive}/me/drive/items/${encodeURIComponent(fileId)}/content`;
    }
    if (!item) throw new BadRequestException("Jenis berkas ini tidak bisa diambil (mis. Formulir / Situs Google).");
    if (item.folder) throw new BadRequestException("Pilih berkas, bukan folder.");
    const limitMb = Math.round(this.maxBytes / 1024 / 1024);
    if (item.size !== null && item.size > this.maxBytes)
      throw new BadRequestException(`Berkas lebih dari ${limitMb} MB (batas unggah Akasha).`);
    const res = await this.fetchRaw(account, url);
    if (!res.ok || !res.body)
      throw new ProviderError(`${providerLabel(account.provider)}: berkas gagal diambil (status ${res.status}).`);
    let seen = 0;
    const max = this.maxBytes;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        seen += chunk.length;
        if (seen > max) return done(new Error(`Berkas lebih dari ${limitMb} MB (batas unggah Akasha).`));
        done(null, chunk);
      },
    });
    const stream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>).pipe(limiter);
    return { name: item.name, mimeType: item.mimeType, size: item.size, stream };
  }

  /** Permintaan mentah ke API Drive dengan token akun (unduhan berkas; mengikuti pengalihan OneDrive ke alamat unduh). */
  async fetchRaw(account: OAuthAccount, url: string, init: RequestInit = {}, timeoutMs = 10 * 60_000) {
    const token = await this.oauth.accessToken(account);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  }
}
