import { type EnhanceScope, shouldEnhance } from "./markdown-enhance";

/**
 * Logika murni Markdown Converter (docs/ARCHITECTURE.md §3.14): format mana yang dikirim ke service converter
 * (MarkItDown + Docling), preferensi per user, dan cakupan "konversi ulang".
 */

export type ConverterPdfMode = "auto" | "markitdown" | "docling";
export type ConverterMode = "auto" | "markitdown" | "docling";
export type ConverterEngine = "markitdown" | "docling";

export interface ConverterPrefs {
  /** Kirim berkas ke converter sebelum pembaca bawaan (bawaan menyala bila service tersedia). */
  enabled: boolean;
  /** PDF: auto = MarkItDown untuk PDF berlapisan teks, Docling untuk scan / bergambar. */
  pdfMode: ConverterPdfMode;
  /** Bila converter tidak menghasilkan teks (gambar / scan), boleh dibaca AI (memakai token)? */
  aiOcrFallback: boolean;
  /** Rapikan Markdown hasil converter dengan AI (struktur & salah baca; memakai token tugas "Rapikan dokumen"). */
  aiEnhance: boolean;
  /** `ocr` = hanya hasil Docling (gambar & scan, tempat salah baca terjadi); `all` = semua berkas. */
  aiEnhanceScope: EnhanceScope;
}

export const DEFAULT_CONVERTER_PREFS: ConverterPrefs = {
  enabled: true,
  pdfMode: "auto",
  aiOcrFallback: true,
  aiEnhance: false,
  aiEnhanceScope: "ocr",
};

export const ENHANCE_SCOPES: EnhanceScope[] = ["ocr", "all"];

export const PDF_MODES: ConverterPdfMode[] = ["auto", "markitdown", "docling"];

export function normalizeConverterPrefs(raw: unknown): ConverterPrefs {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_CONVERTER_PREFS.enabled,
    pdfMode: PDF_MODES.includes(value.pdfMode as ConverterPdfMode)
      ? (value.pdfMode as ConverterPdfMode)
      : DEFAULT_CONVERTER_PREFS.pdfMode,
    aiOcrFallback:
      typeof value.aiOcrFallback === "boolean" ? value.aiOcrFallback : DEFAULT_CONVERTER_PREFS.aiOcrFallback,
    aiEnhance: typeof value.aiEnhance === "boolean" ? value.aiEnhance : DEFAULT_CONVERTER_PREFS.aiEnhance,
    aiEnhanceScope: ENHANCE_SCOPES.includes(value.aiEnhanceScope as EnhanceScope)
      ? (value.aiEnhanceScope as EnhanceScope)
      : DEFAULT_CONVERTER_PREFS.aiEnhanceScope,
  };
}

/**
 * Ekstensi yang dikirim ke converter. Teks polos (txt, md, json, yaml, csv) tidak — pembaca bawaan sudah sama persis
 * dan tanpa perjalanan jaringan. Harus bagian dari daftar yang didukung service (`converter/app/logic.py`).
 */
const CONVERTER_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "pptx",
  "epub",
  "msg",
  "html",
  "htm",
  "xhtml",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
]);

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/epub+zip": "epub",
  "application/vnd.ms-outlook": "msg",
  "text/html": "html",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export function converterExtension(mimeType: string, fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return ext || MIME_EXTENSION[mimeType.split(";")[0].trim().toLowerCase()] || "";
}

/** Berkas ini dibaca converter (bukan pembaca bawaan)? */
export const converterHandles = (mimeType: string, fileName: string) =>
  CONVERTER_EXTENSIONS.has(converterExtension(mimeType, fileName));

/**
 * Format teks yang juga diterima service converter (MarkItDown) tetapi di worker ekstraksi dibaca pembaca bawaan. Pustaka
 * Dokumen menerimanya (unggah .md/.txt/.csv untuk dirapikan) — sama dengan `CONVERTER_ACCEPT` frontend.
 */
const LIBRARY_TEXT_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "txt",
  "md",
  "markdown",
  "rst",
  "yaml",
  "yml",
]);

/** Berkas ini bisa diunggah ke pustaka Dokumen Markdown Converter? */
export const libraryAccepts = (mimeType: string, fileName: string) => {
  const ext = converterExtension(mimeType, fileName);
  return CONVERTER_EXTENSIONS.has(ext) || LIBRARY_TEXT_EXTENSIONS.has(ext);
};

/** Gambar / PDF = isi bisa berupa scan → boleh dibaca AI bila converter tidak menemukan teks. */
export const isOcrCandidate = (mimeType: string, fileName: string) => {
  const ext = converterExtension(mimeType, fileName);
  return ext === "pdf" || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
};

/**
 * Cakupan "konversi ulang" berkas lama:
 * - `ai_ocr` = berkas yang dulu dibaca AI (memakai token) → kini dibaca Docling,
 * - `missing` = berkas yang dulu tidak terbaca (format tidak didukung, kosong, gagal),
 * - `legacy` = semua yang belum dibaca converter (termasuk dua di atas).
 */
export type ReconvertScope = "ai_ocr" | "missing" | "legacy" | "unenhanced";
export const RECONVERT_SCOPES: ReconvertScope[] = ["ai_ocr", "missing", "legacy", "unenhanced"];

export const CONVERTER_METHODS = new Set<string>(["markitdown", "docling"]);

/**
 * `unenhanced` = sudah dibaca converter tetapi belum dirapikan AI (sesuai cakupan rapikan) — dipakai setelah "Rapikan
 * dengan AI" dinyalakan. `enhanceScope` hanya dipakai cakupan itu.
 */
export function needsReconvert(
  extraction: { status: string; method?: string | null; enhanced?: boolean } | null,
  scope: ReconvertScope,
  enhanceScope: EnhanceScope = "ocr",
): boolean {
  // Berkas tanpa baris ekstraksi tidak pernah masuk antrian ekstraksi (bukan berkas yang bisa dibaca ulang)
  if (!extraction) return false;
  if (extraction.status === "pending" || extraction.status === "extracting") return false;
  const method = extraction.method ?? null;
  if (scope === "unenhanced") {
    return (
      extraction.status === "completed" &&
      !!method &&
      CONVERTER_METHODS.has(method) &&
      !extraction.enhanced &&
      shouldEnhance(enhanceScope, method)
    );
  }
  if (method && CONVERTER_METHODS.has(method)) return false;
  if (scope === "ai_ocr") return method === "ocr";
  const missing = extraction.status === "unsupported" || extraction.status === "failed";
  if (scope === "missing") return missing;
  return true;
}

/** Perkiraan kasar token (± 4 karakter per token), sama dengan service converter. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Pustaka Markdown Converter: batas antrean & jumlah dokumen tersimpan per user. */
export const LIBRARY_MAX_PENDING = 10;
export const LIBRARY_MAX_DOCUMENTS = 500;

/** Judul dokumen pustaka dari nama berkas: tanpa ekstensi, maks. 200 karakter. */
export function libraryTitle(fileName: string) {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "Hasil konversi").slice(0, 200);
}

/** Ringkasan hasil konversi untuk daftar pustaka (tanpa isi Markdown). */
export function librarySummary(result: unknown) {
  const r = (result ?? {}) as {
    pages?: unknown;
    tokens?: unknown;
    durationMs?: unknown;
    enhanced?: { rejected?: unknown; parts?: unknown } | null;
    enhanceError?: unknown;
  };
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    pages: num(r.pages),
    tokens: num(r.tokens),
    durationMs: num(r.durationMs),
    enhanced: !!r.enhanced,
    enhanceError: typeof r.enhanceError === "string" ? r.enhanceError : null,
  };
}
