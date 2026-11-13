/**
 * Logika murni "Rapikan dengan AI" (Markdown Converter, docs/ARCHITECTURE.md §3.14): Markdown hasil MarkItDown/Docling
 * dirapikan model AI — struktur & salah baca saja, bukan menulis ulang. Bagian dipotong per judul agar output model tidak
 * terpotong; setiap hasil diperiksa `checkEnhanced` (isi & angka harus tetap) dan ditolak bila model meringkas / mengarang.
 */

/** Panjang satu bagian yang dikirim ke AI (± 3.000 token; output model tetap jauh di bawah batas 16 rb token). */
export const ENHANCE_CHUNK_CHARS = 12_000;
/** Batas total teks yang dirapikan per berkas (± 50 rb token masukan); lebih panjang = tidak dirapikan. */
export const ENHANCE_MAX_CHARS = 200_000;

export type EnhanceScope = "ocr" | "all";

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const HEADING = /^#{1,6}\s/;

/**
 * Pecah Markdown menjadi bagian ≤ `maxChars`, utamakan batas judul lalu baris kosong; tabel tidak pernah dipotong
 * (tabel yang lebih panjang dari batas menjadi satu bagian sendiri). Hasil digabung kembali dengan `\n\n`.
 */
export function splitForEnhance(markdown: string, maxChars = ENHANCE_CHUNK_CHARS): string[] {
  // Blok = paragraf / tabel / daftar (dipisah baris kosong); judul selalu memulai blok baru
  const blocks = markdown
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .flatMap((block) => block.split(/\n(?=#{1,6}\s)/))
    .map((block) => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let chunk = "";
  for (const block of blocks) {
    const startsSection = HEADING.test(block);
    const next = chunk ? `${chunk}\n\n${block}` : block;
    // Judul baru di atas ± 60 % batas = awal bagian baru (bagian tetap utuh secara makna)
    if (chunk && (next.length > maxChars || (startsSection && chunk.length > maxChars * 0.6))) {
      chunks.push(chunk);
      chunk = block;
    } else {
      chunk = next;
    }
    while (chunk.length > maxChars && !TABLE_LINE.test(chunk.split("\n")[0])) {
      // Paragraf raksasa (OCR tanpa baris kosong): potong di akhir kalimat terdekat sebelum batas
      const cut = Math.max(chunk.lastIndexOf(". ", maxChars), chunk.lastIndexOf("\n", maxChars), maxChars / 2);
      chunks.push(chunk.slice(0, cut + 1).trim());
      chunk = chunk.slice(cut + 1).trim();
    }
  }
  if (chunk.trim()) chunks.push(chunk);
  return chunks;
}

export interface EnhanceContext {
  fileName: string;
  engine: string;
  part: number;
  parts: number;
}

/** Prompt rapikan: hanya struktur & salah baca; isi, urutan, angka, dan istilah tidak berubah. */
export function buildEnhancePrompt(chunk: string, context: EnhanceContext) {
  const ocr = context.engine === "docling";
  return [
    "Anda adalah perapi dokumen. Teks di dalam <markdown> adalah hasil konversi otomatis berkas",
    `"${context.fileName}"${ocr ? " lewat OCR (pemindaian gambar)" : ""}, bagian ${context.part} dari ${context.parts}.`,
    "Kembalikan teks yang SAMA dalam Markdown yang rapi. Yang BOLEH diperbaiki:",
    "- struktur: judul (#, ##, ###) sesuai hierarki dokumen, daftar bernomor/berbutir, tabel Markdown yang rusak atau",
    "  terbaca sebagai teks biasa, paragraf yang terpotong di tengah kalimat (gabungkan), baris yang terpecah;",
    "- kata terpenggal (mis. 'penge- lolaan' → 'pengelolaan'), spasi yang hilang/berlebih, tanda baca yang jelas rusak;",
    ocr
      ? "- salah baca OCR yang JELAS dari konteks (mis. 'Kementrian' tetap, tetapi 'Peraturan Menteri Keuangan Nornor' → 'Nomor', 'rn' → 'm', '0' ↔ 'O' pada kata);"
      : "- salah ketik akibat konversi yang JELAS dari konteks;",
    "- kepala/kaki halaman dan nomor halaman yang berulang di tengah teks boleh dibuang.",
    "Yang DILARANG:",
    "- meringkas, menghilangkan kalimat, menambah informasi, menerjemahkan, atau menyusun ulang kalimat dengan kata sendiri;",
    "- mengubah angka, nominal, tanggal, nomor surat/peraturan, NIP, kode, nama orang/instansi, dan kutipan pasal;",
    "- menebak bagian yang tidak terbaca: biarkan apa adanya atau tulis [tidak terbaca].",
    "Jawab HANYA dengan Markdown hasil rapikan, tanpa pengantar, tanpa penjelasan, tanpa pagar ```.",
    "",
    "<markdown>",
    chunk,
    "</markdown>",
  ].join("\n");
}

/** Buang bungkus yang kadang ditambahkan model: pagar ```markdown, tag <markdown>, kalimat pengantar. */
export function cleanEnhanceOutput(text: string) {
  let out = text.trim();
  out = out.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  out = out.replace(/^<markdown>\s*([\s\S]*?)\s*<\/markdown>$/i, "$1").trim();
  out = out.replace(/^(berikut|here is|here's)[^\n]*:\s*\n+/i, "").trim();
  return out;
}

const PAGE_NUMBER = /^(?:-\s*\d{1,4}\s*-|halaman\s+\d{1,4}(?:\s+dari\s+\d{1,4})?)$/i;

/** Baris pendek yang muncul ≥ 3 kali di seluruh dokumen = kepala/kaki halaman (boleh dibuang saat dirapikan). */
export function boilerplateLines(markdown: string): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line && line.length <= 80 && !line.startsWith("|") && !line.startsWith("#")) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n >= 3).map(([line]) => line));
}

/** Gambar berkas lokal (`![ikon](A2_ikon111.jpg)`): tidak terbaca model, boleh dibuang saat dirapikan. */
const LOCAL_IMAGE = /!\[[^\]]*\]\((?!https?:)[^)\s]*\)/g;

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "").length;
/**
 * Deret digit bermakna (≥ 3 digit) yang wajib tetap ada. Dibandingkan per deret, bukan per "angka berformat", agar
 * merapikan spasi/pemisah (`P270726-5. 696` → `P270726-5.696`) tidak dianggap mengubah angka; mengganti digit tetap ketahuan.
 * Nama berkas gambar lokal (`![ikon](A2_ikon111.jpg)`) tidak dihitung: boleh dibuang.
 */
const numbers = (text: string) => new Set(text.replace(LOCAL_IMAGE, "").match(/\d{3,}/g) ?? []);

export interface EnhanceCheck {
  ok: boolean;
  reason?: string;
  /** Rasio huruf+angka hasil terhadap asli. */
  ratio: number;
}

/**
 * Hasil AI diterima bila isi kira-kira sama panjang (huruf+angka 85–115 % — header/footer/nomor halaman boleh dibuang,
 * ringkasan tidak) dan ≥ 95 % angka penting tetap ada. Selain itu bagian asli dipakai (model dianggap meringkas/mengarang).
 */
export function checkEnhanced(original: string, enhanced: string, boilerplate: Set<string> = new Set()): EnhanceCheck {
  // Kepala/kaki halaman & nomor halaman boleh dibuang model (diizinkan prompt) → tidak dihitung sebagai isi
  original = original
    .split("\n")
    .filter((line) => !boilerplate.has(line.trim()) && !PAGE_NUMBER.test(line.trim()))
    .join("\n")
    .replace(LOCAL_IMAGE, "");
  const base = letters(original);
  const ratio = base ? letters(enhanced) / base : 1;
  if (!enhanced.trim()) return { ok: false, reason: "jawaban kosong", ratio };
  if (ratio < 0.85) return { ok: false, reason: "isi berkurang (diringkas?)", ratio };
  if (ratio > 1.15) return { ok: false, reason: "isi bertambah (dikarang?)", ratio };
  const want = numbers(original);
  if (want.size) {
    const have = numbers(enhanced);
    const missing = [...want].filter((n) => !have.has(n));
    if (1 - missing.length / want.size < 0.95) {
      return { ok: false, reason: `angka/nomor berubah (hilang: ${missing.slice(0, 4).join(", ")})`, ratio };
    }
  }
  return { ok: true, ratio };
}

/** Berkas dengan mesin ini dirapikan pada cakupan ini? (`ocr` = hanya hasil Docling, tempat salah baca terjadi). */
export const shouldEnhance = (scope: EnhanceScope, engine: string) => scope === "all" || engine === "docling";
