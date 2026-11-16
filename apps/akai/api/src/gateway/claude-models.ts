import Anthropic from "@anthropic-ai/sdk";

/**
 * Kemampuan model Claude untuk jalur agen (disalin dari Akasha `ai/providers/anthropic.client.ts` & `ai/ai-endpoint.ts`
 * saat proxy agen dipindah ke Akai, docs/AKAI.md §7 langkah 2). Nama model dinormalkan karena router bisa memakai
 * `claude-opus-5.5` atau `anthropic/claude-opus-5-5`.
 */
export const canonicalClaudeModel = (model: string) => (model.split("/").pop() ?? model).replace(/\./g, "-");

/** Model yang menerima `output_config.effort`. */
export const EFFORT_MODELS = /^claude-(opus-5|sonnet-5-5|haiku-5-5|fable-5)/;
/** Model yang menerima `fallbacks: "default"` (dijalankan ulang di model lain bila ditolak filter keamanan). */
export const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;
export const modelMatches = (pattern: RegExp, model: string) => pattern.test(canonicalClaudeModel(model));

/** Router menolak fitur beta → permintaan diulang sekali tanpa fitur itu (status 400 dengan pesan beta/fallbacks/…). */
export const isUnsupportedFeatureError = (error: unknown) =>
  error instanceof Anthropic.APIError &&
  error.status === 400 &&
  /beta|fallback|output_config|effort|block_binding|thinking|unknown|unsupported|not supported|extra/i.test(
    error.message,
  );

/** Alamat dasar untuk SDK Anthropic: akhiran `/v1` dibuang (SDK menambahkannya sendiri). */
export const anthropicBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
