/**
 * Backup data Akasha ke Google Drive / OneDrive (logika murni, diuji di backup-logic.spec.ts): pengaturan, kapan backup jatuh tempo
 * (jadwal & masa akses hampir habis), nama folder/berkas, dan pemangkasan backup lama.
 */
import { safeFileName } from "./drive-logic";

export const BACKUP_SCHEDULES = ["off", "weekly", "monthly"] as const;
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 20;

const DAY = 24 * 60 * 60_000;
/** Backup otomatis saat masa akses tinggal ≤ 7 hari / sudah habis (baca saja), paling sering sekali seminggu. */
export const EXPIRY_WINDOW_DAYS = 7;

export interface BackupSettings {
  accountId: string | null;
  schedule: BackupSchedule;
  /** Jumlah backup yang disimpan di Drive; yang lebih lama dihapus */
  keep: number;
  /** Sertakan berkas (lampiran, dokumen); false = data saja */
  includeFiles: boolean;
  /** Backup otomatis saat masa akses hampir habis / sudah habis */
  onExpiry: boolean;
  /** ID folder Google Drive (diisi server) */
  rootFolderId?: string | null;
  filesFolderId?: string | null;
}

export function normalizeBackupSettings(raw: unknown): BackupSettings {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const keep = typeof v.keep === "number" && Number.isFinite(v.keep) ? Math.round(v.keep) : 5;
  return {
    accountId: typeof v.accountId === "string" && v.accountId ? v.accountId : null,
    schedule: BACKUP_SCHEDULES.includes(v.schedule as BackupSchedule) ? (v.schedule as BackupSchedule) : "off",
    keep: Math.min(Math.max(keep, BACKUP_KEEP_MIN), BACKUP_KEEP_MAX),
    includeFiles: typeof v.includeFiles === "boolean" ? v.includeFiles : true,
    onExpiry: typeof v.onExpiry === "boolean" ? v.onExpiry : true,
    rootFolderId: typeof v.rootFolderId === "string" ? v.rootFolderId : null,
    filesFolderId: typeof v.filesFolderId === "string" ? v.filesFolderId : null,
  };
}

/** Backup terjadwal jatuh tempo? (mingguan = 7 hari, bulanan = 30 hari sejak backup berhasil terakhir) */
export function scheduleDue(schedule: BackupSchedule, lastSuccessAt: Date | null, now: Date) {
  if (schedule === "off") return false;
  if (!lastSuccessAt) return true;
  const days = schedule === "weekly" ? 7 : 30;
  return now.getTime() - lastSuccessAt.getTime() >= days * DAY;
}

/**
 * Backup karena masa akses hampir habis: akses berakhir ≤ 7 hari lagi (atau sudah berakhir = baca saja) dan belum ada backup berhasil
 * dalam 7 hari terakhir. Akses tanpa batas (`expiresAt` null) tidak pernah.
 */
export function expiryDue(expiresAt: Date | null, lastSuccessAt: Date | null, now: Date) {
  if (!expiresAt) return false;
  if (expiresAt.getTime() - now.getTime() > EXPIRY_WINDOW_DAYS * DAY) return false;
  return !lastSuccessAt || now.getTime() - lastSuccessAt.getTime() >= EXPIRY_WINDOW_DAYS * DAY;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Nama folder satu backup, waktu WIB (UTC+7) agar sama dengan yang dilihat pemilik: "Backup 2026-11-19 0930". */
export function runFolderName(at: Date) {
  const wib = new Date(at.getTime() + 7 * 60 * 60_000);
  return `Backup ${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())} ${pad(wib.getUTCHours())}${pad(wib.getUTCMinutes())}`;
}

/** Nama berkas di folder "berkas" bersama: awalan checksum agar berkas sama tidak diunggah dua kali & nama asli tetap terbaca. */
export function backupFileName(checksum: string, originalName: string) {
  return `${checksum.slice(0, 12)}-${safeFileName(originalName)}`;
}

/** Backup lama yang dihapus agar tersisa `keep` backup berhasil terbaru (masukan urut terbaru dulu). */
export function runsToPrune<T extends { status: string }>(runs: T[], keep: number): T[] {
  const done = runs.filter((r) => r.status === "done");
  return done.slice(keep);
}

/** Petunjuk singkat di folder backup (dibaca manusia). */
export const BACKUP_README = [
  "Backup Akasha (workingspace.id)",
  "",
  "akasha-backup.json  = seluruh data Akasha akun ini: data kerja (Planner, Notes, Working Space, File Control, e-Kinerja, SRIKANDI, …),",
  "                      My Notebook, Pengajuan, dan daftar berkas.",
  "Folder 'berkas'     = isi berkas (lampiran, dokumen). Satu berkas disimpan sekali dan dipakai bersama oleh beberapa backup;",
  "                      nama diawali 12 huruf checksum. Daftar 'files' di akasha-backup.json menunjukkan berkas mana milik item apa.",
  "",
  "Berkas yang sedang di arsip dingin tidak disalin ulang: lokasinya di Drive dicatat di daftar 'files' (cold: true).",
  "Item yang dikunci PIN ikut tersalin apa adanya — simpan folder ini di Drive pribadi Anda.",
].join("\n");
