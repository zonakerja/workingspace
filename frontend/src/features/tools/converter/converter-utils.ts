import type {
  ConverterEnhanceScope,
  ConverterMode,
  ConverterReconvertScope,
  ConverterTokenComparison,
} from "@/types/api";

/** Cara berkas dibaca (`asset_extractions.metadata.method`) → label. */
export const METHOD_LABELS: Record<string, string> = {
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
export const isFreeMethod = (method: string) => method !== "ocr";

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

export const TRY_MODE_OPTIONS: { value: ConverterMode; label: string }[] = [
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

export interface TokenRow {
  label: string;
  hint?: string;
  tokens: number | null;
  /** Persen hemat dibanding berkas dibaca langsung (negatif = lebih banyak); null = tidak dibandingkan. */
  saving: number | null;
}

const savingOf = (tokens: number, base: number | null) =>
  base && base > 0 ? Math.round((1 - tokens / base) * 100) : null;

/** Baris tabel Bandingkan token: berkas langsung → Markdown → dirapikan (dibaca AI) → biaya sekali rapikan. */
export function tokenRows(data: Extract<ConverterTokenComparison, { available: true }>): TokenRow[] {
  const rows: TokenRow[] = [
    {
      label: "Berkas dibaca AI langsung",
      hint: data.rawFileNote ?? "PDF/gambar dikirim apa adanya ke model",
      tokens: data.rawFile,
      saving: null,
    },
    {
      label: "Markdown converter",
      hint: "yang dibaca fitur AI setiap kali berkas dipakai",
      tokens: data.markdown,
      saving: savingOf(data.markdown, data.rawFile),
    },
  ];
  if (data.enhance) {
    rows.push(
      {
        label: "Markdown dirapikan AI",
        hint: "yang dibaca fitur AI bila Rapikan dinyalakan",
        tokens: data.enhance.result,
        saving: savingOf(data.enhance.result, data.rawFile),
      },
      {
        label: "Biaya sekali rapikan",
        hint: `masukan ${formatCount(data.enhance.input)} + keluaran ${formatCount(data.enhance.output)} token (sekali per berkas)`,
        tokens: data.enhance.input + data.enhance.output,
        saving: null,
      },
    );
  }
  return rows;
}

/** Nama provider AI untuk keterangan "Dirapikan oleh …". */
export function providerLabel(provider: string | null) {
  const labels: Record<string, string> = { anthropic: "Claude", gemini: "Gemini", openai: "OpenAI" };
  return provider ? (labels[provider] ?? provider) : "AI";
}

/** Format yang diterima kotak "Coba konversi" (sama dengan service converter). */
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
