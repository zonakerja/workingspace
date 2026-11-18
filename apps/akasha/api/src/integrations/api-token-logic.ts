import { createHash, randomBytes } from "node:crypto";

/**
 * Logika murni token akses pribadi & MCP (tanpa database): bentuk token, hash, cakupan izin, masa berlaku, ringkasan
 * argumen untuk log. Diuji di `api-token-logic.spec.ts`.
 */

const TOKEN_PREFIX = "akasha_pat_";
/** Jumlah token aktif maksimal per user. */
export const MAX_TOKENS_PER_USER = 20;

export const API_SCOPES = [
  "knowledge:read",
  "knowledge:write",
  "workspace:read",
  "workspace:write",
  "ai:chat",
  "requests:read",
  "requests:write",
  "ai:model",
  "agent:menus",
  "ekinerja:robot",
  "srikandi:robot",
  "siman:robot",
  "mail:read",
  "mail:send",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  "knowledge:read": "Baca basis pengetahuan (cari & buka catatan vault)",
  "knowledge:write": "Tulis usulan ke Inbox vault Obsidian",
  "workspace:read": "Baca data kerja (cari data, agenda, to-do & task)",
  "workspace:write": "Buat & ubah data kerja (bisa dibatalkan) dan ajukan hapus (menunggu persetujuan Anda)",
  "ai:chat": "Tanya asisten Akasha (memakai provider & kuota AI Anda)",
  "requests:read": "Baca pengajuan & Antrian Verifikasi",
  "requests:write": "Catat pengajuan baru & jalankan analisis/telaah AI (persetujuan tetap oleh Anda)",
  "ai:model": "Model AI agen lewat Akasha (memakai provider, API key & kuota Anda — key tidak pernah keluar)",
  "agent:menus": "Usulkan fitur non-native: workflow & koneksi (tampil setelah Anda setujui di Approval)",
  "ekinerja:robot":
    "e-Kinerja: usulkan pemetaan kegiatan ke RHK & narasi renaksi, jalankan robot baca (ambil SKP, pantau, periksa); pengisian hanya setelah Anda setujui",
  "srikandi:robot":
    "SRIKANDI: jalankan robot baca (daftar naskah keluar, referensi, klasifikasi) & periksa Register; pendaftaran naskah hanya setelah Anda setujui",
  "siman:robot": "SIMAN: jalankan robot baca (jaga sesi, baca isi halaman tanpa klik) untuk mempelajari tiket",
  "mail:read": "Baca email masuk (menu Email) & jadikan to-do",
  "mail:send": "Ajukan kirim email atas nama Anda (terkirim hanya setelah Anda setujui di Approval)",
};

/** Token baru: `akasha_pat_` + 32 byte acak (base64url) — cukup acak sehingga hash SHA-256 tanpa salt aman. */
export const generateToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
/** Awal token yang ditampilkan agar user mengenali token (bukan rahasia). */
export const tokenPrefix = (token: string) => token.slice(0, TOKEN_PREFIX.length + 4);

/**
 * Bentuk token yang diterima: token pribadi `akasha_pat_…` atau kunci agen Hermes (`HERMES_API_KEY`, lihat
 * `agent-setup.ts`) — huruf/angka/`_`/`-`. JWT login (bertitik) selalu ditolak. Keabsahan tetap ditentukan hash di database.
 */
export const looksLikeToken = (value: string) => /^[A-Za-z0-9_-]{24,128}$/.test(value);

/** Ambil token dari header `Authorization: Bearer <token>`. */
export function bearerToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? "");
  return match && looksLikeToken(match[1]) ? match[1] : null;
}

/** Cakupan valid & unik dari input (nilai asing dibuang). */
export const normalizeScopes = (scopes: unknown): ApiScope[] =>
  Array.isArray(scopes) ? API_SCOPES.filter((s) => scopes.includes(s)) : [];

/** Waktu kedaluwarsa dari jumlah hari (null = tanpa batas). */
export const expiryFrom = (days: number | null | undefined, now: Date) =>
  days ? new Date(now.getTime() + days * 24 * 3600 * 1000) : null;

export const isExpired = (expiresAt: Date | null, now: Date) => !!expiresAt && expiresAt.getTime() <= now.getTime();

/** "Terakhir dipakai" cukup diperbarui sekali per 5 menit agar tiap panggilan tool tidak menulis ke database. */
export const shouldTouch = (lastUsedAt: Date | null, now: Date) =>
  !lastUsedAt || now.getTime() - lastUsedAt.getTime() > 5 * 60 * 1000;

/** Ringkasan argumen tool untuk log: teks panjang dipotong, kedalaman dibatasi. */
export function summarizeArgs(value: unknown, depth = 2): unknown {
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "…";
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => summarizeArgs(v, depth - 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 20)
      .map(([k, v]) => [k, summarizeArgs(v, depth - 1)]),
  );
}

/** Tanggal "hari ini" zona Asia/Jakarta sebagai YYYY-MM-DD (server bisa berzona UTC). */
export const todayYmd = (now: Date, timeZone = "Asia/Jakarta") =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Label tanggal panjang Bahasa Indonesia, mis. "Sabtu, 24 Oktober 2026". */
export const todayLabel = (now: Date, timeZone = "Asia/Jakarta") =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

/** YYYY-MM-DD → format tanggal to-do Akasha (`Date.toDateString()`, mis. "Sat Oct 24 2026"). */
export function ymdToDateString(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toDateString();
}

export const isYmd = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Jumlah hari antara dua tanggal YMD (inklusif tidak dihitung). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
