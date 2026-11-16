/** Aturan sumber model & katalog (logika murni, diuji di source-logic.spec.ts). docs/AKAI.md §3. */

export const SOURCE_KINDS = ["gemini", "anthropic", "openai", "router"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const API_FORMATS = ["openai", "anthropic"] as const;
export type ApiFormat = (typeof API_FORMATS)[number];
export const ROUTER_PRESETS = ["classai", "openrouter", "omniroute", "custom"] as const;
export type RouterPreset = (typeof ROUTER_PRESETS)[number];

/** Alamat & format bawaan per preset router (alamat bisa diubah pemilik, mis. OmniRoute milik sendiri). */
export const PRESET_DEFAULTS: Record<RouterPreset, { label: string; baseUrl: string | null; format: ApiFormat }> = {
  classai: { label: "Classai", baseUrl: "https://router.classai.id/v1", format: "openai" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", format: "openai" },
  omniroute: { label: "OmniRoute", baseUrl: null, format: "openai" },
  custom: { label: "Router lain", baseUrl: null, format: "openai" },
};

/** Alamat katalog resmi provider langsung (SDK resmi dipakai untuk memanggil model). */
export const OFFICIAL_BASE: Record<Exclude<SourceKind, "router">, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain", "host.docker.internal"]);

/** Host jaringan lokal / privat (tidak boleh dituju server produksi atas isian pengguna — SSRF). */
export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    return true;
  if (PRIVATE_V4.some((re) => re.test(host))) return true;
  if (host.includes(":"))
    return host === "::1" || host === "::" || /^(fe8|fe9|fea|feb|fc|fd)/.test(host) || host.startsWith("::ffff:");
  return false;
}

export type BaseUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** Alamat API router: https tanpa kredensial/query; host lokal hanya di luar production (router tiruan saat uji). */
export function normalizeBaseUrl(raw: string, production: boolean): BaseUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Alamat API tidak valid. Contoh: https://router.example.com/v1" };
  }
  if (url.username || url.password) return { ok: false, error: "Alamat API tidak boleh memuat nama/sandi." };
  if (url.search || url.hash) return { ok: false, error: "Alamat API tidak boleh memuat ? atau #." };
  const privateHost = isPrivateHost(url.hostname);
  if (production && privateHost) return { ok: false, error: "Alamat API harus alamat publik (bukan jaringan lokal)." };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && privateHost && !production))
    return { ok: false, error: "Alamat API harus diawali https://" };
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

/** 4 karakter terakhir key untuk ditampilkan; key pendek tidak ditampilkan. */
export const keyHint = (apiKey: string) => (apiKey.length >= 12 ? apiKey.slice(-4) : "");

export interface CatalogEntry {
  modelId: string;
  name: string;
  contextLength: number | null;
  /** Rupiah/dolar per 1 juta token, sesuai mata uang `currency`; null = tidak diketahui (isi manual) */
  priceIn: number | null;
  priceOut: number | null;
  currency: string | null;
  vision: boolean;
  tools: boolean;
  embedding: boolean;
}

const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};
const perMillion = (perToken: number | null) => (perToken === null ? null : Math.round(perToken * 1e6 * 1e4) / 1e4);

/**
 * Respons `GET /models` (OpenAI-compatible: `{ data: [...] }`, OpenRouter menambah `pricing`, `context_length`,
 * `architecture.input_modalities`, `supported_parameters`; Anthropic: `{ data: [{ id, display_name }] }`) → entri katalog.
 * Kemampuan yang tidak disebut router dianggap tidak diketahui (false) — pemilik bisa menyalakannya manual.
 */
export function parseCatalog(body: unknown): CatalogEntry[] {
  const list = (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const raw of list) {
    const item = raw as Record<string, unknown>;
    const modelId = typeof item.id === "string" ? item.id.trim() : "";
    if (!modelId || modelId.length > 200 || seen.has(modelId)) continue;
    seen.add(modelId);
    const pricing = (item.pricing ?? {}) as Record<string, unknown>;
    const arch = (item.architecture ?? {}) as Record<string, unknown>;
    const inputs = Array.isArray(arch.input_modalities) ? arch.input_modalities.map(String) : [];
    const outputs = Array.isArray(arch.output_modalities) ? arch.output_modalities.map(String) : [];
    const params = Array.isArray(item.supported_parameters) ? item.supported_parameters.map(String) : [];
    const priceIn = perMillion(num(pricing.prompt));
    const priceOut = perMillion(num(pricing.completion));
    const name = [item.name, item.display_name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    out.push({
      modelId,
      name: (name ?? modelId).slice(0, 200),
      contextLength: num(item.context_length) ?? num(item.context_window),
      priceIn,
      priceOut,
      currency: priceIn !== null || priceOut !== null ? "USD" : null,
      vision: inputs.includes("image"),
      tools: params.includes("tools"),
      embedding: outputs.includes("embeddings") || /embed/i.test(modelId),
    });
  }
  return out.sort((a, b) => a.modelId.localeCompare(b.modelId));
}
