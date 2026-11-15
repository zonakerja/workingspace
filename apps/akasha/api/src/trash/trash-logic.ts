/** Logika murni Sampah (diuji di `trash-logic.spec.ts`). */

export const TRASH_KINDS = ["record", "asset", "request", "notebook", "vault_note"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const TRASH_SOURCES = ["user", "agent"] as const;
export type TrashSource = (typeof TRASH_SOURCES)[number];

/** Masa simpan di Sampah sebelum dihapus permanen otomatis (keputusan user 2026-11-10). */
export const TRASH_RETENTION_DAYS = 30;
/** Penghapusan oleh pelaku yang sama dalam selang ini dianggap satu tindakan (dipulihkan bersama). */
export const TRASH_BATCH_WINDOW_MS = 20_000;

/**
 * Record yang dihapus tanpa masuk Sampah: centang rutinitas (batal centang = hapus) dan log riwayat. Memulihkannya
 * tidak bermakna dan akan memenuhi Sampah.
 */
export const NO_TRASH_RECORD_TYPES = new Set(["completion", "para_archive_log", "archive_move_log"]);

export const trashExpiry = (deletedAt: Date, days = TRASH_RETENTION_DAYS) =>
  new Date(deletedAt.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * Kelompok penghapusan: pakai kelompok terakhir pelaku yang sama bila masih dalam selang (mis. hapus project →
 * action, agenda, dan berkasnya dihapus beruntun oleh browser), selain itu kelompok baru.
 */
export function chooseBatch(
  last: { batchId: string; deletedAt: Date; actorId: string | null; source: string } | null,
  actorId: string | null,
  source: TrashSource,
  now: Date,
  newId: () => string,
) {
  if (
    last &&
    last.actorId === actorId &&
    last.source === source &&
    now.getTime() - last.deletedAt.getTime() <= TRASH_BATCH_WINDOW_MS
  )
    return last.batchId;
  return newId();
}

const TITLE_KEYS = ["title", "name", "label", "nama", "number", "subject", "hal", "description", "content"];

/** Judul tampilan record dari payload-nya (kunci judul umum, dipotong 120 karakter). */
export function recordTitle(payload: Record<string, unknown> | undefined, fallback: string) {
  for (const key of TITLE_KEYS) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.replace(/\s+/g, " ").trim();
      return text.length > 120 ? `${text.slice(0, 117)}…` : text;
    }
  }
  return fallback;
}
