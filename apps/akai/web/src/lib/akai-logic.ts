/** Logika tampilan Akai web (murni, diuji di akai-logic.test.ts). Aturan tugas = salinan task-logic.ts backend. */
import type { AiTask, Model, RouterPreset, SourceKind } from "./api";

export const MAX_MODELS_PER_TASK = 5;

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  gemini: "Google Gemini (langsung)",
  anthropic: "Anthropic Claude (langsung)",
  openai: "OpenAI (langsung)",
  router: "Router",
};

/** Preset router: alamat bawaan (null = wajib diisi). Sama dengan PRESET_DEFAULTS backend. */
export const ROUTER_PRESETS: { key: RouterPreset; label: string; baseUrl: string | null; hint: string }[] = [
  {
    key: "classai",
    label: "Classai",
    baseUrl: "https://router.classai.id/v1",
    hint: "Paket token + kredit, katalog tanpa harga.",
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    hint: "Ratusan model, harga per token di katalog.",
  },
  { key: "omniroute", label: "OmniRoute", baseUrl: null, hint: "Router milik sendiri: isi alamatnya." },
  {
    key: "custom",
    label: "Router lain",
    baseUrl: null,
    hint: "Alamat API apa pun yang kompatibel OpenAI / Anthropic.",
  },
];

export const TASK_HINT: Record<AiTask, string> = {
  chat: "Asisten & chat My Notebook.",
  general: "Fitur AI lain (ringkasan, saran, dll.). Juga bawaan bila aplikasi tidak menyebut tugas.",
  agent: "Otak agen (memakai alat). Pilih model yang mendukung alat.",
  document: "Merapikan hasil konversi dokumen. Cocok model murah.",
  ocr: "Membaca teks dari gambar / PDF scan. Wajib model yang bisa membaca gambar.",
  embedding: "Pencarian makna (768 dimensi). Hanya model embedding.",
  transcribe: "Transkrip audio. Hanya Gemini langsung yang mendukung audio.",
};

/** Model yang boleh dipilih untuk tugas (aturan sama dengan taskModelsProblem backend). */
export function modelFitsTask(
  task: AiTask,
  model: Pick<Model, "enabled" | "embedding" | "vision" | "audio" | "source">,
) {
  if (!model.enabled) return false;
  if (task === "embedding") return model.embedding;
  if (model.embedding) return false;
  if (task === "ocr") return model.vision;
  if (task === "transcribe") return model.audio && model.source.kind === "gemini";
  return true;
}

/** Pindahkan butir ke atas (-1) / bawah (+1); di luar batas = tetap. */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const number = new Intl.NumberFormat("id-ID");

/** 1234567 → "1,2 jt"; 12345 → "12,3 rb"; kecil apa adanya. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (value >= 10_000) return `${(value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} rb`;
  return number.format(value);
}

/** Biaya per mata uang → "US$0,42 · Rp1.200"; kosong = "—". */
export function formatCost(cost: Record<string, number>): string {
  const parts = Object.entries(cost)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => {
      try {
        return new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency,
          maximumFractionDigits: value < 1 ? 4 : 2,
        }).format(value);
      } catch {
        return `${number.format(value)} ${currency}`;
      }
    });
  return parts.length ? parts.join(" · ") : "—";
}

/** Harga per 1 jt token untuk tampilan ("0,27 / 1,1" atau "—"). */
export function formatPrice(priceIn: number | null, priceOut: number | null, currency: string | null) {
  if (priceIn === null && priceOut === null) return "—";
  const f = (v: number | null) => (v === null ? "?" : v.toLocaleString("id-ID", { maximumFractionDigits: 4 }));
  return `${f(priceIn)} / ${f(priceOut)}${currency && currency !== "USD" ? ` ${currency}` : ""}`;
}

/** Pencarian katalog per kata (id model + nama). */
export function matchesQuery(text: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.toLowerCase();
  return words.every((w) => haystack.includes(w));
}
