/** Aturan gateway model (logika murni, diuji di gateway-logic.spec.ts). docs/AKAI.md §4. */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Status upstream yang boleh dialihkan ke model cadangan: kuota/saldo (429, 402), waktu habis (408), server sibuk/galat
 * (5xx). Key ditolak (401/403), model tidak ada (404), dan permintaan salah (400/422) tidak dialihkan — itu masalah
 * konfigurasi/isi yang harus terlihat (aturan sama dengan Akasha `isFallbackStatus`).
 */
export const isFallbackStatus = (status: number) => status === 429 || status === 402 || status === 408 || status >= 500;

/**
 * Status ke aplikasi pemanggil: kuota → 429, selain itu 422. Tidak pernah 401 (aplikasi mengira sesinya habis) atau ≥ 502
 * (aplikasi mengira Akai mati) — aturan §15 Akasha.
 */
export const callerStatus = (upstream: number) => (upstream === 429 || upstream === 402 ? 429 : 422);

const hasPart = (messages: unknown, type: string) =>
  Array.isArray(messages) &&
  messages.some(
    (m) => isObject(m) && Array.isArray(m.content) && m.content.some((p) => isObject(p) && p.type === type),
  );

/** Permintaan memuat gambar (`image_url`) → hanya model yang bisa membaca gambar. */
export const needsVision = (messages: unknown) => hasPart(messages, "image_url");

/** Permintaan memuat berkas (`file`, format OpenAI: PDF base64) → hanya model yang bisa membaca PDF. */
export const needsPdf = (messages: unknown) => hasPart(messages, "file");

/** Permintaan memakai alat (`tools`) → hanya model yang mendukung alat. */
export const needsTools = (body: Json) => Array.isArray(body.tools) && body.tools.length > 0;

export interface TokenUsage {
  input: number | null;
  output: number | null;
  cached: number | null;
}

const int = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);

/** `usage` format OpenAI (chat completions / embeddings) → token. */
export function usageFromOpenAi(usage: unknown): TokenUsage {
  if (!isObject(usage)) return { input: null, output: null, cached: null };
  const details = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  return { input: int(usage.prompt_tokens), output: int(usage.completion_tokens), cached: int(details.cached_tokens) };
}

/**
 * Perkiraan biaya dari harga per 1 juta token model. Model berpaket (paket token router) = 0 selama paket ada; harga tidak
 * diketahui = null. Token cache dihitung setengah harga masukan (pola umum router; perkiraan, bukan tagihan).
 */
export function estimateCost(
  usage: TokenUsage,
  model: { priceIn: number | null; priceOut: number | null; currency: string | null; packaged: boolean },
): { cost: number | null; currency: string | null } {
  if (model.packaged) return { cost: 0, currency: model.currency };
  if (model.priceIn === null && model.priceOut === null) return { cost: null, currency: null };
  const cached = usage.cached ?? 0;
  const freshIn = Math.max(0, (usage.input ?? 0) - cached);
  const cost =
    (freshIn * (model.priceIn ?? 0) +
      cached * (model.priceIn ?? 0) * 0.5 +
      (usage.output ?? 0) * (model.priceOut ?? 0)) /
    1e6;
  return { cost: Math.round(cost * 1e6) / 1e6, currency: model.currency };
}

/** Pesan galat upstream yang aman ditampilkan (tanpa isi mentah panjang). */
export function upstreamMessage(status: number, body: unknown): string {
  const error = isObject(body) ? body.error : undefined;
  const message =
    (isObject(error) && typeof error.message === "string" && error.message) ||
    (typeof error === "string" && error) ||
    (isObject(body) && typeof body.message === "string" && body.message) ||
    "";
  const text = message.replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === 401 || status === 403) return `API key ditolak sumber model${text ? `: ${text}` : "."}`;
  if (status === 404) return `Model tidak ditemukan di sumber model${text ? `: ${text}` : "."}`;
  if (status === 429) return `Kuota / batas pemakaian sumber model habis${text ? `: ${text}` : "."}`;
  return `Sumber model menjawab galat ${status}${text ? `: ${text}` : "."}`;
}
