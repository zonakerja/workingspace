/**
 * Drive sebagai penyimpanan (docs/AKUN-TERSAMBUNG.md tahap 4). Logika murni, diuji di drive-logic.spec.ts: berkas Google Drive /
 * OneDrive → bentuk seragam, ekspor dokumen Google, pengaturan & syarat arsip dingin, nama berkas di Drive, potongan unggahan.
 */
import { extname } from "node:path";

export interface DriveItem {
  id: string;
  name: string;
  /** MIME berkas hasil unduhan (dokumen Google = format ekspornya) */
  mimeType: string;
  /** null = tidak diketahui (dokumen Google sebelum diekspor) */
  size: number | null;
  folder: boolean;
  modifiedAt: string | null;
  /** Dokumen Google asli diunduh lewat ekspor ke MIME ini */
  exportMime?: string;
}

/** Dokumen Google asli → format Office / PDF saat diambil. Jenis lain (Formulir, Situs, …) tidak bisa diambil. */
const GOOGLE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ".docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: ".pptx",
  },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
};

const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

/** Nama berkas aman untuk header & unggahan; ekstensi ditambahkan bila belum ada. */
export function safeFileName(name: string, ext = "") {
  const clean =
    name
      // eslint-disable-next-line no-control-regex -- buang karakter kendali dari nama berkas
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "berkas";
  return ext && extname(clean).toLowerCase() !== ext ? `${clean}${ext}` : clean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Metadata Google Drive (files.get `id,name,mimeType,size,modifiedTime`). Null = jenis yang tidak bisa diambil. */
export function fromGoogleFile(raw: unknown): DriveItem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  const mime = str(r.mimeType);
  if (!id) return null;
  if (mime === GOOGLE_FOLDER)
    return { id, name: str(r.name), mimeType: mime, size: null, folder: true, modifiedAt: str(r.modifiedTime) || null };
  if (mime.startsWith("application/vnd.google-apps.")) {
    const exp = GOOGLE_EXPORTS[mime];
    if (!exp) return null;
    return {
      id,
      name: safeFileName(str(r.name), exp.ext),
      mimeType: exp.mime,
      size: null,
      folder: false,
      modifiedAt: str(r.modifiedTime) || null,
      exportMime: exp.mime,
    };
  }
  return {
    id,
    name: safeFileName(str(r.name)),
    mimeType: mime || "application/octet-stream",
    size: num(r.size),
    folder: false,
    modifiedAt: str(r.modifiedTime) || null,
  };
}

/** Item OneDrive (Graph driveItem). Paket OneNote & item tanpa berkas/folder diabaikan. */
export function fromGraphItem(raw: unknown): DriveItem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const file = r.file as { mimeType?: string } | undefined;
  const folder = !!r.folder;
  if (!file && !folder) return null;
  return {
    id,
    name: folder ? str(r.name) : safeFileName(str(r.name)),
    mimeType: folder ? "folder" : str(file?.mimeType) || "application/octet-stream",
    size: folder ? null : num(r.size),
    folder,
    modifiedAt: str(r.lastModifiedDateTime) || null,
  };
}

/** Folder dulu, lalu nama (seperti penjelajah berkas). */
export const sortDriveItems = (items: DriveItem[]) =>
  [...items].sort((a, b) =>
    a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, "id", { sensitivity: "base" }),
  );

// ---------------------------------------------------------------------------------------------- arsip dingin

export interface ColdStorageSettings {
  enabled: boolean;
  /** Akun OAuth (dengan izin Drive) tempat berkas dipindah */
  accountId: string | null;
  /** Berkas yang tidak dibuka selama ini (hari) dipindah */
  afterDays: number;
  /** Hanya berkas sebesar ini atau lebih (MB) */
  minSizeMb: number;
  /** Folder "Akasha Arsip" di Google Drive (dibuat sekali) */
  folderId: string | null;
}

const COLD_DEFAULTS: ColdStorageSettings = {
  enabled: false,
  accountId: null,
  afterDays: 180,
  minSizeMb: 1,
  folderId: null,
};
export const COLD_MIN_DAYS = 30;
export const COLD_MAX_DAYS = 3650;

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeColdSettings(raw: unknown): ColdStorageSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    accountId: str(r.accountId) || null,
    afterDays: Math.round(clamp(r.afterDays, COLD_MIN_DAYS, COLD_MAX_DAYS, COLD_DEFAULTS.afterDays)),
    minSizeMb: clamp(r.minSizeMb, 0, 1024, COLD_DEFAULTS.minSizeMb),
    folderId: str(r.folderId) || null,
  };
}

/**
 * Konteks berkas yang tidak pernah dipindah: salinan berkas vault Obsidian (dibaca ulang dari disk), templat dokumen (sering dipakai
 * sebagai dasar dokumen baru), dan berkas sumber Notebook (dibaca setiap chat).
 */
export const COLD_EXCLUDED_CONTEXTS = ["knowledge_vault", "office-template", "notebook"];

/** Batas tiap putaran pemindahan agar satu putaran tidak memakan bandwidth/kuota Drive terlalu lama. */
const COLD_RUN_MAX_FILES = 25;
const COLD_RUN_MAX_BYTES = 2 * 1024 ** 3;

export const coldCutoff = (settings: Pick<ColdStorageSettings, "afterDays">, now: Date) =>
  new Date(now.getTime() - settings.afterDays * 86_400_000);
export const coldMinBytes = (settings: Pick<ColdStorageSettings, "minSizeMb">) =>
  Math.max(1, Math.round(settings.minSizeMb * 1024 * 1024));

/** Ambil kandidat sampai batas jumlah & ukuran putaran (kandidat sudah urut terlama dulu). */
export function pickColdBatch<T extends { size: number }>(
  candidates: T[],
  maxFiles = COLD_RUN_MAX_FILES,
  maxBytes = COLD_RUN_MAX_BYTES,
) {
  const out: T[] = [];
  let bytes = 0;
  for (const c of candidates) {
    if (out.length >= maxFiles) break;
    if (out.length && bytes + c.size > maxBytes) continue;
    out.push(c);
    bytes += c.size;
  }
  return out;
}

/** Nama berkas di Drive: bagian unik key objek + nama asli (key objek = `<user>/<yyyy>/<mm>/<ts>-<uuid><ext>`). */
export function coldFileName(objectKey: string, originalName: string) {
  const stem = (objectKey.split("/").pop() ?? objectKey).replace(/\.[^.]*$/, "").slice(0, 60);
  return safeFileName(`${stem} ${originalName}`);
}

/** Potongan unggahan bertahap: kelipatan 320 KiB (syarat OneDrive) sekaligus 256 KiB (Google). 10 MiB. */
export const UPLOAD_CHUNK = 32 * 327_680;

export const contentRange = (start: number, length: number, total: number) =>
  `bytes ${start}-${start + length - 1}/${total}`;
