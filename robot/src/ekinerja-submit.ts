import { monthName, normalize } from "./ekinerja-renaksi.js";

/**
 * Logika murni **Kirim Penilaian Ke Atasan** e-Kinerja (diuji di `ekinerja-submit.test.ts`). Halaman Rencana Aksi
 * (`/skp/renaksi/<id SKP>`, direkam 2026-11-15 dengan Playwright tanpa klik): bulan draf punya grup tombol di bawah tabelnya
 * **"Edit Rencana Aksi Kerja"** + **"Kirim Penilaiaan Ke Atasan"** (ejaan e-Kinerja: "Penilaiaan", diawali ikon). Bulan yang
 * sudah diajukan menampilkan "Tanggal Pengajuan Penilaiaan : dd-mm-yyyy ( Hari Kerja Ke-n )" dan tidak punya tombol itu.
 *
 * Mengirim = mengajukan penilaian bulan itu ke atasan (tindakan resmi; sesudahnya isian terkunci). Robot hanya menjalankannya
 * atas permintaan pemilik yang dibuktikan dengan PIN di LifeOS (diperiksa backend), pada bulan yang isinya sama persis dengan
 * LifeOS dan lengkap (setiap baris punya renaksi, realisasi, bukti). Dialog konfirmasi setelah tombol diklik **belum pernah
 * direkam** (atas perintah pemilik tidak pernah dikirim saat membangun), jadi robot hanya menyetujui dialog yang jelas meminta
 * konfirmasi pengiriman penilaian; dialog lain dibatalkan dan dilaporkan.
 */

/** Teks tombol (ikon di depan dibuang): "Kirim Penilaiaan Ke Atasan" / "Kirim Penilaian ke Atasan". */
export const SUBMIT_BUTTON = /^\W*kirim penilaia+n ke atasan\s*$/i;
export const isSubmitButton = (text: string) => SUBMIT_BUTTON.test(text.replace(/\s+/g, " ").trim());

export interface SubmitRequest {
  skpExternalId: string;
  /** YYYY-MM */
  period: string;
  /** Kunci baris indikator yang menurut LifeOS ada di bulan itu (pembanding: e-Kinerja harus sama persis) */
  expectedKeys: string[];
  dryRun: boolean;
}

export function parseSubmitRequest(body: unknown): { request: SubmitRequest } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const skpExternalId = typeof b.skpExternalId === "string" ? b.skpExternalId.trim() : "";
  const period = typeof b.period === "string" ? b.period.trim() : "";
  if (!/^\d+$/.test(skpExternalId)) return { error: "Nomor SKP tidak valid." };
  if (!monthName(period)) return { error: "Periode tidak valid." };
  const keys = Array.isArray(b.expectedKeys)
    ? b.expectedKeys.filter((k): k is string => typeof k === "string" && !!k.trim()).slice(0, 200)
    : [];
  if (!keys.length) return { error: "Isian LifeOS bulan ini kosong." };
  return {
    request: { skpExternalId, period, expectedKeys: [...new Set(keys.map(normalize))], dryRun: b.dryRun !== false },
  };
}

interface BlockRow {
  key: string;
  renaksi: string[];
  realisasi: string[];
  bukti: string[];
}

/** Baris yang belum lengkap (renaksi / realisasi / bukti kosong = "Belum diisi" di e-Kinerja). */
export function incompleteRows(rows: BlockRow[]) {
  return rows
    .map((r) => ({
      key: r.key,
      missing: (
        [
          ["renaksi", "Renaksi"],
          ["realisasi", "Realisasi"],
          ["bukti", "Bukti Data Dukung"],
        ] as const
      )
        .filter(([k]) => !r[k].some((v) => v.trim()))
        .map(([, label]) => label),
    }))
    .filter((r) => r.missing.length);
}

/** Baris e-Kinerja dibanding isian LifeOS: yang hanya ada di salah satu sisi. */
export function rowDifference(rows: BlockRow[], expectedKeys: string[]) {
  const have = new Set(rows.map((r) => r.key));
  const want = new Set(expectedKeys.map(normalize));
  return {
    onlyEkinerja: [...have].filter((k) => !want.has(k)),
    onlyLifeos: [...want].filter((k) => !have.has(k)),
  };
}

/**
 * Tombol yang boleh diklik pada dialog setelah Kirim Penilaian: hanya bila teks dialog jelas tentang mengirim / mengajukan
 * penilaian ke atasan, dan tombolnya persetujuan ("Ya", "Kirim", "OK", …). Selain itu `null` → robot membatalkan.
 */
export function pickSubmitConfirm(dialogText: string, buttons: string[]) {
  const text = dialogText.replace(/\s+/g, " ").trim();
  // Wajib kata kerja kirim/ajukan: dialog yang hanya menyebut "atasan"/"penilaian" (mis. memilih penilai) bukan konfirmasi
  if (!/kirim|ajukan|pengajuan/i.test(text) || !/penilaia+n|atasan|renaksi|rencana aksi/i.test(text)) return null;
  if (/hapus|dihapus|batalkan|tolak/i.test(text)) return null;
  const clean = buttons.map((b) => b.replace(/\s+/g, " ").trim());
  const accept = /^(ya|iya|ok|oke|kirim|ajukan|ya,? kirim|ya,? ajukan|lanjut|lanjutkan|setuju|yes|send|submit)\b/i;
  const reject = /batal|tidak|cancel|kembali|tutup|no\b/i;
  return clean.find((b) => accept.test(b) && !reject.test(b)) ?? null;
}

/** Pesan hasil setelah mengirim. */
export function submitOutcome(message: string): "sent" | "failed" | "unknown" {
  const text = message.replace(/\s+/g, " ").trim();
  if (/gagal|galat|error|tidak dapat|tidak bisa|wajib|harus|belum diisi/i.test(text)) return "failed";
  if (/berhasil|sukses|terkirim|telah dikirim|diajukan/i.test(text)) return "sent";
  return "unknown";
}
