import type {
  ConvertedDocument,
  ConvertedDocumentStatus,
  ConverterResult,
  ConverterEnhanceScope,
  ConverterMode,
  ConverterReconvertScope,
} from "@/types/api";

/** Cara berkas dibaca (`asset_extractions.metadata.method`) → label. */
const METHOD_LABELS: Record<string, string> = {
  markitdown: "MarkItDown",
  docling: "Docling (OCR lokal)",
  ocr: "OCR AI (memakai token)",
  pdf: "Pembaca PDF bawaan",
  docx: "Pembaca DOCX bawaan",
  xlsx: "Pembaca XLSX bawaan",
  plain: "Teks polos",
  onlyoffice: "Konversi ONLYOFFICE",
};

/** Cara baca yang tidak memakai token AI. */
const isFreeMethod = (method: string) => method !== "ocr";

export const PDF_MODE_OPTIONS: { value: ConverterMode; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Otomatis (disarankan)",
    hint: "PDF berlapisan teks → MarkItDown (cepat); PDF hasil scan atau bergambar/grafik → Docling (OCR).",
  },
  { value: "markitdown", label: "Selalu MarkItDown", hint: "Paling cepat; teks di dalam gambar tidak terbaca." },
  {
    value: "docling",
    label: "Selalu Docling",
    hint: "Tata letak & tabel paling rapi, teks di gambar ikut terbaca; lebih lambat (± 1–5 dtk per halaman).",
  },
];

export const MODE_OPTIONS: { value: ConverterMode; label: string }[] = [
  { value: "auto", label: "Otomatis" },
  { value: "markitdown", label: "MarkItDown" },
  { value: "docling", label: "Docling" },
];

export const RECONVERT_INFO: Record<ConverterReconvertScope, { label: string; hint: string }> = {
  ai_ocr: {
    label: "Yang dulu dibaca AI",
    hint: "Gambar & PDF scan yang dulu di-OCR AI (memakai token) dibaca ulang dengan Docling.",
  },
  missing: { label: "Yang belum terbaca", hint: "Berkas berformat tidak didukung, kosong, atau gagal dibaca." },
  legacy: { label: "Semua berkas lama", hint: "Semua berkas yang belum dibaca converter (hasil lebih rapi)." },
  unenhanced: {
    label: "Belum dirapikan AI",
    hint: "Berkas yang sudah dibaca converter tetapi belum dirapikan AI (sesuai cakupan rapikan).",
  },
};

export const ENHANCE_SCOPE_OPTIONS: { value: ConverterEnhanceScope; label: string; hint: string }[] = [
  {
    value: "ocr",
    label: "Hanya hasil OCR (disarankan)",
    hint: "Gambar & PDF scan yang dibaca Docling — tempat salah baca, kata terpotong, dan tata letak berantakan terjadi.",
  },
  {
    value: "all",
    label: "Semua berkas",
    hint: "Termasuk Word/Excel/PDF berlapisan teks. Biasanya sudah rapi, jadi token rapikan lebih sering tidak sepadan.",
  },
];

/** Nama provider AI untuk keterangan "Dirapikan oleh …". */
export function providerLabel(provider: string | null) {
  const labels: Record<string, string> = { anthropic: "Claude", gemini: "Gemini", openai: "OpenAI" };
  return provider ? (labels[provider] ?? provider) : "AI";
}

/** Format yang diterima unggahan pustaka Dokumen (sama dengan service converter). */
export const CONVERTER_ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.pptx,.epub,.msg,.html,.htm,.csv,.json,.xml,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff";

/** Nama berkas hasil unduhan: `Laporan.pdf` → `Laporan.md`. */
export function markdownFileName(name: string) {
  const base = name
    .replace(/[\\/]/g, "_")
    .replace(/\.[^.]+$/, "")
    .trim();
  return `${base || "hasil-konversi"}.md`;
}

/** Judul catatan Inbox dari nama berkas (maks. 120 karakter, sesuai batas server). */
export function inboxTitle(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .trim()
      .slice(0, 120) || "Hasil konversi"
  );
}

export const formatCount = (value: number) => value.toLocaleString("id-ID");

/** Durasi singkat: 40 → "40 ms", 1850 → "1,9 dtk", 65000 → "1 mnt 5 dtk". */
export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} mnt ${seconds} dtk` : `${minutes} mnt`;
}

/** Ringkas jumlah berkas per cara baca untuk kartu statistik, urut terbanyak; tidak dikenal = "Lainnya". */
export function methodRows(byMethod: Record<string, number>) {
  return Object.entries(byMethod)
    .filter(([, count]) => count > 0)
    .map(([method, count]) => ({
      method,
      label: METHOD_LABELS[method] ?? "Lainnya",
      count,
      free: isFreeMethod(method),
    }))
    .sort((a, b) => b.count - a.count);
}

export const DOCUMENT_STATUS_LABELS: Record<ConvertedDocumentStatus, string> = {
  queued: "Antre",
  processing: "Diproses",
  done: "Selesai",
  failed: "Gagal",
};

export const isDocumentPending = (status: ConvertedDocumentStatus) => status === "queued" || status === "processing";

/** Dokumen pustaka yang sudah selesai → bentuk hasil konversi untuk penampil bersama (`ConversionResultView`). */
export function documentResult(doc: ConvertedDocument): ConverterResult | null {
  if (doc.status !== "done" || !doc.result || !doc.engine) return null;
  const { enhanced, ...rest } = doc.result;
  return {
    ...rest,
    engine: doc.engine,
    markdown: doc.markdown ?? "",
    enhanced: enhanced && doc.enhancedMarkdown ? { ...enhanced, markdown: doc.enhancedMarkdown } : null,
  };
}

/** Saring pustaka per kata (judul & nama berkas, tanpa peka huruf besar/kecil). */
export function filterDocuments<T extends { title: string; fileName: string }>(docs: T[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return docs;
  return docs.filter((doc) => {
    const text = `${doc.title} ${doc.fileName}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Ukuran berkas singkat: 900 → "900 B", 1536 → "1,5 KB". */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${units[unit]}`;
}
