import { RECORD_TABLES, type RecordType, type TableSpec } from "../records/record-schema";

/** Logika murni aksi agen atas record (diuji di `agent-action-logic.spec.ts`). */

/** Permintaan agen yang menunggu keputusan pemilik (Setujui / Tolak). */
export const APPROVAL_KINDS = ["delete", "ekinerja_fill", "srikandi_register", "send_email"] as const;

export const AGENT_ACTION_STATUSES = ["applied", "undone", "pending", "approved", "rejected", "failed"] as const;

/**
 * Record yang tidak boleh ditulis agen: log riwayat dan data hasil sinkron robot (sumber kebenarannya sistem asal,
 * diisi ulang otomatis). Semua jenis lain = data kerja pemilik yang boleh dibuat/diubah agen.
 */
const AGENT_READONLY_TYPES = new Set<string>([
  "para_archive_log",
  "archive_move_log",
  "action_plan_month",
  "srikandi_letter",
  "srikandi_inbox",
  "srikandi_reference",
  "skp",
  "skp_target",
]);

export const AGENT_WRITABLE_TYPES = (Object.keys(RECORD_TABLES) as RecordType[]).filter(
  (type) => !AGENT_READONLY_TYPES.has(type),
);

export const isAgentWritable = (type: string): type is RecordType => AGENT_WRITABLE_TYPES.includes(type as RecordType);

/** Key sistem yang tidak boleh diubah agen lewat patch. */
const PROTECTED_KEYS = new Set(["id", "userId", "share", "createdAt", "updatedAt", "deletedAt"]);

/**
 * Perubahan sebagian: key yang dikirim menimpa nilai lama, `null` menghapus key, key lain tetap. Agen tidak perlu (dan
 * tidak bisa) mengirim ulang seluruh isi, sehingga field yang tidak disebut tidak hilang.
 */
export function patchPayload(before: Record<string, unknown>, patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (PROTECTED_KEYS.has(key)) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Isi awal record baru dari agen: key sistem dibuang, `id` = clientId. */
export function createPayload(id: string, input: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (!PROTECTED_KEYS.has(key)) payload[key] = value;
  return { ...payload, id };
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .filter((k) => k !== "share")
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;

/** Dua isi record sama (urutan key & penanda berbagi diabaikan) — Batalkan hanya aman bila record belum diubah lagi. */
export const samePayload = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Key yang berubah (untuk ringkasan di daftar aksi). */
export function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => k !== "id" && !samePayload(before?.[k], after?.[k])).sort();
}

const KIND_HINT: Record<string, string> = {
  string: "teks",
  int: "bilangan bulat",
  float: "angka",
  bool: "true/false",
  ymd: "tanggal YYYY-MM-DD",
  dateKey: 'tanggal format "Thu Oct 08 2026" (Date.toDateString)',
  timestamp: "waktu ISO 8601",
  json: "JSON (objek/array)",
};

/** Daftar field per jenis record untuk agen (field lain tetap boleh, disimpan apa adanya). */
export function describeRecordType(type: RecordType) {
  const spec: TableSpec = RECORD_TABLES[type];
  return {
    type,
    writable: isAgentWritable(type),
    titleKey: spec.titleKey ?? null,
    dateKey: spec.dateKey ?? null,
    fields: spec.fields.map((f) => ({ key: f.key, kind: KIND_HINT[f.kind] ?? f.kind })),
  };
}

/** Potong teks panjang di isi record agar ringkasan untuk agen tidak membengkak. */
export function compactPayload(payload: Record<string, unknown>, maxText = 400): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "doc" || key === "ink") continue;
    out[key] = typeof value === "string" && value.length > maxText ? `${value.slice(0, maxText)}…` : value;
  }
  return out;
}
