import { normalizeOption } from "./srikandi-register.js";

/**
 * Logika murni **Kirim Konsep** SRIKANDI (diuji di `srikandi-send.test.ts`). Halaman Detail Log Naskah Keluar
 * (`/pembuatan-naskah-keluar/log-naskah-keluar/detail?id=…`, direkam 2026-11-15 dengan Playwright tanpa klik) menampilkan
 * judul "Detail Log Naskah Keluar", tombol **Kirim Konsep** dan **Kembali**, lalu kotak "Naskah ini belum dikirim — Pastikan
 * Naskah sudah lengkap dan sesuai. Naskah akan dikirimkan kepada Verifikator", diikuti Nomor Naskah, Tanggal, Hal, Isi Ringkas.
 * Tombol hanya ada pada konsep yang belum dikirim. Di Log, hanya konsep yang belum dikirim yang punya kotak centang (Kirim
 * Banyak Konsep — tidak pernah dipakai robot).
 *
 * Kirim Konsep = tindakan resmi (naskah sampai ke verifikator). Robot hanya menjalankannya atas permintaan pemilik yang
 * dibuktikan dengan PIN di LifeOS (diperiksa backend), dan hanya pada konsep berhal sama dengan entri Register. Dialog
 * konfirmasi setelah tombol diklik **belum pernah direkam** (atas perintah pemilik konsep uji tidak pernah dikirim), jadi
 * robot hanya menyetujui dialog yang jelas meminta konfirmasi pengiriman; dialog lain dibatalkan dan dilaporkan.
 */

export const DETAIL_PATH_MARK = "/log-naskah-keluar/detail";
export const SEND_BUTTON = /^\s*kirim konsep\s*$/i;
export const UNSENT_MARK = /naskah ini belum dikirim/i;

/** Masukan job Kirim Konsep. */
export interface SendRequest {
  /** Hal entri Register sekarang */
  subject: string;
  /** Hal saat terakhir dikirim ke SRIKANDI (dicari lebih dulu) */
  findSubject: string;
  /** Nomor konsep yang tercatat (pembeda bila ada dua konsep berhal sama) */
  number: string;
  dryRun: boolean;
}

export function parseSendRequest(body: unknown): { request: SendRequest } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const subject = text(b.subject, 1_000);
  if (!subject) return { error: "Hal konsep wajib diisi." };
  return {
    request: {
      subject,
      findSubject: text(b.findSubject, 1_000) || subject,
      number: text(b.number, 200),
      dryRun: b.dryRun !== false,
    },
  };
}

/**
 * Isi halaman detail cocok dengan konsep yang diminta? Hal wajib sama persis (dinormalkan) dengan salah satu hal yang dicari;
 * bila nomor diketahui dan tampil di halaman, nomor juga harus sama.
 */
export function detailMatches(detail: { subject: string; number: string }, request: SendRequest) {
  const subject = normalizeOption(detail.subject);
  const wanted = [request.findSubject, request.subject].map(normalizeOption);
  if (!subject || !wanted.includes(subject)) return false;
  if (request.number && detail.number && normalizeOption(detail.number) !== normalizeOption(request.number))
    return false;
  return true;
}

/** Baris Log yang dikirim: hal sama, belum terkirim, masih bisa diubah (tautan Edit = belum dikirim ke verifikator). */
export function findSendRow<
  T extends { subject: string; number: string; sendStatus: string; editHref?: string | null },
>(rows: T[], request: SendRequest) {
  for (const wanted of [request.findSubject, request.subject]) {
    const want = normalizeOption(wanted);
    const same = rows.filter((r) => normalizeOption(r.subject) === want);
    if (!same.length) continue;
    const byNumber = request.number
      ? same.filter((r) => normalizeOption(r.number) === normalizeOption(request.number))
      : [];
    const pool = byNumber.length ? byNumber : same;
    return pool.find((r) => r.editHref && !/terkirim/i.test(r.sendStatus)) ?? pool[0];
  }
  return null;
}

/**
 * Tombol yang boleh diklik pada dialog setelah Kirim Konsep: hanya bila teks dialog jelas tentang mengirim konsep / naskah
 * ke verifikator, dan tombolnya persetujuan ("Ya", "Kirim", "OK", …). Selain itu `null` → robot membatalkan.
 */
export function pickSendConfirm(dialogText: string, buttons: string[]) {
  const text = dialogText.replace(/\s+/g, " ").trim();
  if (!/kirim|dikirim|verifikator|konsep/i.test(text)) return null;
  if (/hapus|dihapus|tolak|batalkan naskah/i.test(text)) return null;
  const clean = buttons.map((b) => b.replace(/\s+/g, " ").trim());
  const accept = /^(ya|iya|ok|oke|kirim|kirim konsep|ya,? kirim|lanjut|lanjutkan|setuju|yes|send)\b/i;
  const reject = /batal|tidak|cancel|kembali|tutup|no\b/i;
  return clean.find((b) => accept.test(b) && !reject.test(b)) ?? null;
}

/** Pesan hasil setelah mengirim. */
export function sendOutcome(message: string): "sent" | "failed" | "unknown" {
  const text = message.replace(/\s+/g, " ").trim();
  if (/gagal|galat|error|tidak dapat|tidak bisa|wajib|harus/i.test(text)) return "failed";
  if (/berhasil|sukses|terkirim|telah dikirim/i.test(text)) return "sent";
  return "unknown";
}
