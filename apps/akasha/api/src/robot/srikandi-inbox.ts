import { createHash } from "node:crypto";

/**
 * Logika murni sinkron Naskah Masuk SRIKANDI → record `srikandi_inbox` (diuji di `srikandi-inbox.spec.ts`). Robot hanya
 * membaca halaman daftar (docs/AI-AGENT.md §21.14); isian tindak lanjut LifeOS pada record (to-do, balasan) dipertahankan
 * setiap sinkron. Butir yang hilang dari daftar SRIKANDI tidak dihapus (naskah masuk adalah arsip, tidak hilang).
 */

export const INBOX_KINDS = ["masuk", "tembusan", "disposisi", "koordinasi", "arahan"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  masuk: "Naskah masuk",
  tembusan: "Tembusan",
  disposisi: "Disposisi",
  koordinasi: "Koordinasi",
  arahan: "Arahan",
};

/** Kolom yang diisi robot (selain itu milik LifeOS / pemilik dan tidak pernah ditimpa sinkron). */
const SYNCED_KEYS = [
  "kind",
  "date",
  "sentDate",
  "number",
  "subject",
  "origin",
  "info",
  "instruction",
  "extraInstruction",
  "followUpStatus",
  "readStatus",
  "fields",
] as const;

export interface RobotInboxItem {
  kind: string;
  date?: string;
  sentDate?: string;
  number?: string;
  subject?: string;
  origin?: string;
  info?: string;
  instruction?: string;
  extraInstruction?: string;
  followUpStatus?: string;
  readStatus?: string;
  fields?: Record<string, string>;
}

const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Butir dari robot yang sah (jenis dikenal + ada isi yang bisa dikenali). */
export function cleanInboxItem(raw: unknown): RobotInboxItem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = tidy(r.kind) as InboxKind;
  if (!INBOX_KINDS.includes(kind)) return null;
  const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(tidy(v)) ? tidy(v) : "");
  const fields: Record<string, string> = {};
  if (r.fields && typeof r.fields === "object") {
    for (const [k, v] of Object.entries(r.fields as Record<string, unknown>).slice(0, 30)) {
      const text = tidy(v).slice(0, 2_000);
      if (text) fields[tidy(k).slice(0, 80)] = text;
    }
  }
  const item: RobotInboxItem = {
    kind,
    date: ymd(r.date),
    sentDate: ymd(r.sentDate),
    number: tidy(r.number).slice(0, 200),
    subject: tidy(r.subject).slice(0, 1_000),
    origin: tidy(r.origin).slice(0, 500),
    info: tidy(r.info).slice(0, 2_000),
    instruction: tidy(r.instruction).slice(0, 1_000),
    extraInstruction: tidy(r.extraInstruction).slice(0, 2_000),
    followUpStatus: tidy(r.followUpStatus).slice(0, 100),
    readStatus: tidy(r.readStatus).slice(0, 100),
    fields,
  };
  if (!item.number && !item.subject && !item.info && !item.instruction) return null;
  return item;
}

/** ID record stabil per butir (ID detail SRIKANDI acak per muat, jadi dibentuk dari isi yang tetap). */
export function inboxClientId(item: RobotInboxItem) {
  const key = [item.kind, item.number, item.date, item.sentDate, item.subject || item.info, item.instruction]
    .map((v) => tidy(v).toLowerCase())
    .join("|");
  return `si-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

/**
 * Isi record hasil sinkron: kolom dari robot menimpa, kolom LifeOS (todoId, replyId, catatan, firstSeenAt) tetap.
 * `changed` = ada kolom robot yang berubah (tanpa perubahan → tidak ditulis ulang, agar indeks & riwayat tidak berputar).
 */
export function mergeInboxRecord(
  id: string,
  item: RobotInboxItem,
  existing: Record<string, unknown> | null,
  now: string,
): { payload: Record<string, unknown>; changed: boolean; isNew: boolean } {
  const next: Record<string, unknown> = { ...(existing ?? {}), id };
  let changed = !existing;
  for (const key of SYNCED_KEYS) {
    const value = item[key] ?? (key === "fields" ? {} : "");
    if (JSON.stringify(existing?.[key] ?? (key === "fields" ? {} : "")) !== JSON.stringify(value)) changed = true;
    next[key] = value;
  }
  next.firstSeenAt = existing?.firstSeenAt ?? now;
  next.syncedAt = changed ? now : (existing?.syncedAt ?? now);
  return { payload: next, changed, isNew: !existing };
}

/** "BELUM DIBACA" / "Belum" → belum dibaca. */
export const isUnread = (readStatus: unknown) => /belum/i.test(tidy(readStatus));

/** Ringkasan satu baris hasil sinkron. */
export function summarizeInboxSync(counts: Partial<Record<InboxKind, number>>, added: number) {
  const parts = INBOX_KINDS.filter((k) => counts[k] !== undefined).map((k) => `${INBOX_KIND_LABELS[k]} ${counts[k]}`);
  return `${parts.join(", ") || "Tidak ada daftar terbaca"}${added ? ` · ${added} baru` : ""}`;
}
