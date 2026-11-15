/**
 * Logika murni kunci PIN (diuji di `lock-logic.spec.ts`).
 *
 * - Item induk dikunci lewat key payload `locked: true` (disimpan di kolom `extra`); turunannya (Area → Sub Area, Kegiatan,
 *   Project, Action/Task, Agenda, Notes AI tertaut) ikut terkunci lewat graf turunan yang sama dengan fitur Berbagi.
 * - Data tetap utuh di database & indeks RAG. Selama sesi belum memasukkan PIN, respons hanya membawa "kerangka" item
 *   (judul, tanggal, status, relasi) — isi, lampiran, dan rincian disembunyikan.
 */

/** Jenis record yang bisa dikunci langsung (item induk). */
export const LOCKABLE_TYPES = ["para_area", "para_project", "para_resource", "free_note", "ai_note", "list"] as const;
export type LockableType = (typeof LOCKABLE_TYPES)[number];
export const isLockableType = (type: string): type is LockableType =>
  (LOCKABLE_TYPES as readonly string[]).includes(type);

/** Key payload yang tetap terlihat saat item terkunci: judul, waktu, status, dan relasi (agar daftar & kalender utuh). */
export const SKELETON_KEYS = new Set([
  "id",
  "userId",
  "title",
  "name",
  "locked",
  "areaId",
  "parentId",
  "projectId",
  "linkedScheduleId",
  "seriesId",
  "date",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "time",
  "isAllDay",
  "deadline",
  "dueDate",
  "status",
  "completed",
  "completedAt",
  "priority",
  "weight",
  "type",
  "kind",
  "color",
  "icon",
  "pinned",
  "archived",
  "order",
  "createdAt",
  "updatedAt",
  // Arsip PARA: jenis & asal tetap terlihat agar daftar Archives utuh (isi `data` dikerangkakan terpisah)
  "originalType",
  "originalId",
  "archivedAt",
]);

/** Jenis asal arsip PARA → record type item aslinya. */
export const ARCHIVE_ORIGIN_TYPES: Record<string, string> = {
  project: "para_project",
  area: "para_area",
  resource: "para_resource",
  activity: "para_activity",
};

/** Isi `related` arsip PARA → record type turunan. */
const ARCHIVE_RELATED_TYPES: Record<string, string> = {
  projects: "para_project",
  activities: "para_activity",
  tasks: "para_task",
  schedules: "schedule",
};

/** `type:id` item asal + seluruh turunan yang tersimpan di snapshot arsip PARA. */
export function archiveOriginKeys(payload: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const origin = ARCHIVE_ORIGIN_TYPES[String(payload.originalType)];
  if (origin && typeof payload.originalId === "string" && payload.originalId)
    keys.push(`${origin}:${payload.originalId}`);
  return [...keys, ...archiveRelatedKeys(payload)];
}

/** `type:id` turunan di `related` arsip PARA. */
export function archiveRelatedKeys(payload: Record<string, unknown>): string[] {
  const related =
    payload.related && typeof payload.related === "object" ? (payload.related as Record<string, unknown>) : {};
  const keys: string[] = [];
  for (const [key, type] of Object.entries(ARCHIVE_RELATED_TYPES)) {
    const items = related[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id) keys.push(`${type}:${id}`);
    }
  }
  return keys;
}

/** Resource yang sudah masuk File Control (arsip kearsipan) tidak boleh dikunci PIN: prosedur arsip butuh isinya. */
export const isFileControlResource = (payload: Record<string, unknown>) =>
  String(payload.type).toLowerCase() === "file" &&
  typeof payload.archivalStatus === "string" &&
  payload.archivalStatus !== "" &&
  payload.archivalStatus !== "none";

/**
 * Isi pengganti yang aman untuk kode lama yang mengharapkan key ada: teks → "", daftar → [], boolean → false, angka → 0,
 * objek → null. Nilai aslinya tidak pernah ikut terkirim.
 */
const placeholder = (value: unknown): unknown =>
  typeof value === "string"
    ? ""
    : Array.isArray(value)
      ? []
      : typeof value === "boolean"
        ? false
        : typeof value === "number"
          ? 0
          : null;

/**
 * Payload kerangka + daftar key yang disembunyikan (dikirim sebagai `partial` sehingga tulisan mempertahankan isi
 * aslinya lewat `preserve`).
 */
export function redactPayload(payload: Record<string, unknown>) {
  const kept: Record<string, unknown> = {};
  const hidden: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (SKELETON_KEYS.has(key)) kept[key] = value;
    else if (key === "data" && value && typeof value === "object" && !Array.isArray(value)) {
      // Snapshot arsip PARA: judul & relasi item asal tetap ada, isinya dikerangkakan
      kept[key] = redactPayload(value as Record<string, unknown>).payload;
      hidden.push(key);
    } else {
      kept[key] = placeholder(value);
      hidden.push(key);
    }
  }
  return { payload: kept, hidden };
}

/** PIN = tepat 6 angka. */
export const PIN_PATTERN = /^\d{6}$/;
export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && PIN_PATTERN.test(pin);

/** PIN terlalu mudah ditebak (sama semua / urut naik / urut turun). */
export function isWeakPin(pin: string) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  return Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
}

/** Percobaan salah sebelum diblokir sementara. */
export const PIN_MAX_ATTEMPTS = 5;

/**
 * Lama blokir setelah salah ke-`failed`: 0 sampai batas, lalu 15 menit, dan berlipat setiap 5 kesalahan berikutnya
 * (maks. 24 jam) agar tebakan beruntun tidak praktis.
 */
export function pinBlockMs(failed: number) {
  if (failed < PIN_MAX_ATTEMPTS) return 0;
  const rounds = Math.floor(failed / PIN_MAX_ATTEMPTS) - 1;
  return Math.min(15 * 60_000 * 2 ** rounds, 24 * 60 * 60_000);
}

/** Key payload `locked` bernilai benar. */
export const isLockedPayload = (payload: Record<string, unknown> | null | undefined) => payload?.locked === true;
