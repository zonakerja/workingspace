import { createHash } from "node:crypto";

/**
 * Logika murni sinkron daftar **Permohonan SIMAN** → record `siman_request` (diuji di `siman-requests.spec.ts`).
 *
 * Robot membaca dua halaman daftar SIMAN: Permohonan Pengelolaan (semua tiket yang terlihat oleh peran aktif) dan Penetapan
 * Pengelolaan (tiket yang didisposisikan ke akun ini — keputusan pemilik 2026-11-20: tiket yang tampil di Penetapan =
 * "didispo ke kita"). Satu record per nomor tiket (ID record = nomor tiket). Tiket yang tidak lagi tampil tidak dihapus,
 * hanya `active: false`. Isian milik Akasha/pemilik pada record (mis. catatan) tidak pernah ditimpa sinkron.
 */

export const SIMAN_TICKET = /^PPL\d{14,20}$/;

/**
 * Data permohonan tertaut ke akun SIMAN yang dipakai robot (keputusan pemilik 2026-11-20): kunci akun = hash nama pengguna
 * (huruf kecil). Record milik akun lain dihapus saat sinkron atau saat kredensial diganti ke akun lain, jadi daftar & dropdown
 * workflow selalu = tiket akun SIMAN yang sedang tersambung. Login manual tanpa kredensial tersimpan = akun "manual".
 */
export function simanAccountKey(username: string | null): string {
  const name = (username ?? "").trim().toLowerCase();
  return name ? `u-${createHash("sha256").update(name).digest("hex").slice(0, 16)}` : "manual";
}

/**
 * Pengaman firewall SIMAN (situs Kemenkeu memblokir IP yang terlalu agresif — pemilik 2026-11-20):
 * - antar-tugas robot SIMAN milik satu user diberi jeda minimum `SIMAN_PACE_MS`;
 * - daftar Permohonan paling sering sekali per `REQUESTS_COOLDOWN_MS` (tombol, jadwal, maupun agen).
 */
export const SIMAN_PACE_MS = 20_000;
export const REQUESTS_COOLDOWN_MS = 10 * 60_000;

/** Lama menunggu sebelum tugas SIMAN berikutnya boleh mulai (0 = langsung). */
export function simanPaceDelay(lastFinished: number | undefined, now: number): number {
  if (!lastFinished) return 0;
  return Math.max(0, SIMAN_PACE_MS - (now - lastFinished));
}

/** Sisa jeda sinkron daftar Permohonan (0 = boleh). */
export function simanRequestsCooldown(lastStarted: number | undefined, now: number): number {
  if (!lastStarted) return 0;
  return Math.max(0, REQUESTS_COOLDOWN_MS - (now - lastStarted));
}

/** Kolom yang diisi sinkron; key lain di payload milik pemilik. */
const SYNCED_KEYS = [
  "ticket",
  "status",
  "tipe",
  "date",
  "satkerCode",
  "satkerName",
  "pemohon",
  "termohon",
  "value",
  "letterNumber",
  "jenisBmn",
  "korwil",
  "duration",
  "fields",
  "disposed",
  "dispositionStatus",
  "dispositionFields",
  "active",
  "account",
  "accountHint",
] as const;

const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Nilai kolom pertama yang judulnya cocok salah satu pola (judul dinormalkan huruf kecil tanpa tanda baca). */
function pick(row: Record<string, string>, ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    for (const [key, value] of Object.entries(row)) {
      if (pattern.test(norm(key)) && tidy(value)) return tidy(value);
    }
  }
  return "";
}

/** "Rp 1.720.500" / "1.720.500,00" → 1720500. */
export function rupiah(text: string): number | null {
  const main = text.split(",")[0];
  const digits = main.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agt: 8,
  agustus: 8,
  aug: 8,
  sep: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
};

/** Tanggal SIMAN ("28/09/2026", "28-09-2026 10:12", "2026-09-28", "28 Sep 2026") → "YYYY-MM-DD" atau "". */
export function simanDate(text: string): string {
  const t = tidy(text);
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  if (m && valid(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(t);
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  if (m && month && valid(+m[3], month, +m[1])) return `${m[3]}-${pad(month)}-${pad(+m[1])}`;
  return "";
}

export interface SimanRequestRow {
  ticket: string;
  status: string;
  tipe: string;
  date: string;
  satkerCode: string;
  satkerName: string;
  pemohon: string;
  termohon: string;
  value: number | null;
  letterNumber: string;
  jenisBmn: string;
  korwil: string;
  duration: string;
  fields: Record<string, string>;
}

/** Satu baris tabel daftar SIMAN (objek judul kolom → isi) → data permohonan. Tanpa nomor tiket sah = null. */
export function parseRequestRow(raw: unknown): SimanRequestRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    const key = tidy(k).slice(0, 80);
    const value = tidy(v).slice(0, 1_000);
    if (key && value) row[key] = value;
  }
  const ticket = (pick(row, /^nomor tiket$/, /tiket/).match(/PPL\d{14,20}/i)?.[0] ?? "").toUpperCase();
  if (!SIMAN_TICKET.test(ticket)) return null;
  // "Kode/Nama Asal Pembuat" bisa satu kolom ("02205 - KANTOR …") atau dua kolom terpisah
  let satkerCode = pick(row, /^kode asal pembuat$/, /^kode satker$/);
  let satkerName = pick(row, /^nama asal pembuat$/, /^nama satker$/);
  const combined = pick(row, /kode nama asal pembuat/, /asal pembuat/, /asal permohonan/);
  if (combined && (!satkerCode || !satkerName)) {
    const m = /^([\d.]{4,})\s*[-–:]?\s*(.*)$/.exec(combined);
    if (m) {
      satkerCode ||= m[1];
      satkerName ||= m[2] || combined;
    } else satkerName ||= combined;
  }
  return {
    ticket,
    status: pick(row, /^status tiket$/, /^status permohonan$/, /^status$/),
    tipe: pick(row, /tipe pengelolaan/, /^tipe$/),
    date: simanDate(pick(row, /tanggal tiket/, /^tanggal$/)),
    satkerCode,
    satkerName,
    pemohon: pick(row, /^pemohon$/),
    termohon: pick(row, /^termohon$/),
    value: rupiah(pick(row, /nilai permohonan/, /^nilai$/)),
    letterNumber: pick(row, /nomor surat/),
    jenisBmn: pick(row, /jenis bmn/, /jenis aset/),
    korwil: pick(row, /^nama korwil$/, /korwil/),
    duration: pick(row, /durasi/),
    fields: row,
  };
}

/** Isi record sinkron dari baris Permohonan (boleh null bila tiket hanya ada di Penetapan) + baris Penetapan. */
export function requestPayload(
  permohonan: SimanRequestRow | null,
  penetapan: SimanRequestRow | null,
  dispositionKnown: boolean,
): Record<string, unknown> {
  const base = permohonan ?? penetapan;
  if (!base) throw new Error("Tiket tanpa data");
  const out: Record<string, unknown> = {
    ticket: base.ticket,
    status: base.status,
    tipe: base.tipe,
    date: base.date,
    satkerCode: base.satkerCode,
    satkerName: base.satkerName,
    pemohon: base.pemohon,
    termohon: base.termohon,
    value: base.value,
    letterNumber: base.letterNumber,
    jenisBmn: base.jenisBmn,
    korwil: base.korwil,
    duration: base.duration,
    fields: base.fields,
    active: true,
  };
  // Lengkapi kolom kosong dari baris Penetapan (mis. tiket selesai yang tidak tampil di Permohonan aktif)
  if (permohonan && penetapan) {
    for (const key of ["tipe", "date", "satkerCode", "satkerName", "pemohon", "termohon", "letterNumber"] as const) {
      if (!out[key]) out[key] = penetapan[key];
    }
    if (out.value === null) out.value = penetapan.value;
  }
  if (dispositionKnown) {
    out.disposed = !!penetapan;
    out.dispositionStatus = penetapan?.status ?? "";
    out.dispositionFields = penetapan?.fields ?? {};
  }
  return out;
}

/** Kolom Durasi SIMAN bertambah setiap detik → tidak dihitung sebagai perubahan (record tidak ditulis ulang tiap sinkron). */
const VOLATILE_COLUMN = /durasi/i;
const stable = (value: unknown): unknown =>
  value && typeof value === "object" && !Array.isArray(value)
    ? // jsonb menyusun ulang urutan kunci → diurutkan agar perbandingan tidak bergantung urutan
      Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !VOLATILE_COLUMN.test(k))
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    : value;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a) ?? null) === JSON.stringify(stable(b) ?? null);

/**
 * Gabungkan isi sinkron dengan record lama: isian pemilik dipertahankan, `syncedAt` hanya berganti bila ada perubahan.
 * Disposisi tidak diketahui (daftar Penetapan gagal dibaca) = nilai disposisi lama dipertahankan.
 */
export function mergeRequestRecord(
  next: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  now: string,
): { payload: Record<string, unknown>; changed: boolean; isNew: boolean; newlyDisposed: boolean } {
  const prev = existing ?? {};
  const changed =
    !existing || SYNCED_KEYS.some((key) => key !== "duration" && key in next && !same(prev[key], next[key]));
  const payload: Record<string, unknown> = {
    ...prev,
    ...next,
    id: next.ticket,
    syncedAt: changed ? now : (prev.syncedAt ?? now),
  };
  if (!existing) payload.firstSeenAt = now;
  if (next.disposed === true && prev.disposed !== true) payload.disposedSeenAt = now;
  return { payload, changed, isNew: !existing, newlyDisposed: next.disposed === true && prev.disposed !== true };
}

/** Record yang tidak lagi tampil di kedua daftar → ditandai tidak aktif (tidak dihapus). */
export function inactivePayload(existing: Record<string, unknown>, now: string): Record<string, unknown> | null {
  if (existing.active === false) return null;
  return { ...existing, active: false, syncedAt: now };
}

export function summarizeRequestSync(r: {
  total: number;
  disposed: number | null;
  added: number;
  newlyDisposed: number;
}): string {
  const parts = [`${r.total} permohonan terbaca`];
  if (r.disposed !== null) parts.push(`${r.disposed} didisposisikan ke Anda`);
  else parts.push("daftar Penetapan tidak terbaca (tanda disposisi tidak diperbarui)");
  if (r.added) parts.push(`${r.added} baru`);
  if (r.newlyDisposed) parts.push(`${r.newlyDisposed} disposisi baru`);
  return parts.join(", ");
}
