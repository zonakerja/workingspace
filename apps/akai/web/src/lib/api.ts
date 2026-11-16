/** Klien Akai API (same-origin /api). Cookie sesi httpOnly dikirim otomatis; ubah data wajib header X-Akai-Web. */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function messageOf(body: unknown, fallback: string): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.map(String).join(" ");
  if (typeof message === "string" && message) return message;
  return fallback;
}

/** Sesi berakhir → kembali ke halaman masuk (tujuan diingat). */
function toLogin() {
  if (window.location.pathname.startsWith("/login")) return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "X-Akai-Web": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Server Akai tidak dapat dihubungi. Periksa koneksi lalu coba lagi.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/api/me") toLogin();
  if (!res.ok)
    throw new ApiError(
      res.status,
      messageOf(
        data,
        res.status === 429 ? "Terlalu banyak permintaan. Tunggu sebentar." : "Permintaan gagal. Coba lagi.",
      ),
    );
  return data as T;
}

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "Terjadi kesalahan. Coba lagi.";

export type SourceKind = "gemini" | "anthropic" | "openai" | "router";
export type ApiFormat = "openai" | "anthropic";
export type RouterPreset = "classai" | "openrouter" | "omniroute" | "custom";

export interface Me {
  account: { email: string | null; name: string | null };
  accountUrl: string | null;
}

export interface Source {
  id: string;
  kind: SourceKind;
  preset: RouterPreset | null;
  label: string;
  baseUrl: string | null;
  apiFormat: ApiFormat;
  keyHint: string;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  testedAt: string | null;
  catalogAt: string | null;
}

export interface CatalogEntry {
  id: string;
  modelId: string;
  name: string;
  contextLength: number | null;
  priceIn: number | null;
  priceOut: number | null;
  currency: string | null;
  vision: boolean;
  tools: boolean;
  embedding: boolean;
}

export interface ModelCaps {
  vision: boolean;
  pdf: boolean;
  tools: boolean;
  embedding: boolean;
  audio: boolean;
}

export interface Model extends ModelCaps {
  id: string;
  sourceId: string;
  modelId: string;
  label: string;
  contextLength: number | null;
  priceIn: number | null;
  priceOut: number | null;
  currency: string | null;
  packaged: boolean;
  enabled: boolean;
  source: { label: string; kind: SourceKind };
}

export type ModelInput = Partial<
  Pick<Model, "label" | "contextLength" | "priceIn" | "priceOut" | "currency" | "packaged" | "enabled"> & ModelCaps
>;

export type AiTask = "chat" | "general" | "agent" | "document" | "ocr" | "embedding" | "transcribe";

export interface TaskRoute {
  task: AiTask;
  label: string;
  modelIds: string[];
}

export interface UsageGroup {
  key: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cost: Record<string, number>;
}

export interface UsageRecent {
  id: string;
  clientId: string;
  task: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  currency: string | null;
  durationMs: number | null;
  ok: boolean;
  fallbackFrom: string | null;
  error: string | null;
  createdAt: string;
}

export interface Usage {
  days: number;
  total: UsageGroup;
  byModel: UsageGroup[];
  byTask: UsageGroup[];
  byApp: UsageGroup[];
  recent: UsageRecent[];
  labels: Record<string, string>;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  config: () => request<{ sso: boolean }>("GET", "/api/auth/config"),
  logout: () => request<{ ssoLogoutUrl: string | null }>("POST", "/api/auth/logout"),

  sources: () => request<Source[]>("GET", "/api/sources"),
  createSource: (body: {
    kind: SourceKind;
    preset?: RouterPreset;
    label?: string;
    baseUrl?: string;
    apiFormat?: ApiFormat;
    apiKey: string;
  }) => request<Source>("POST", "/api/sources", body),
  updateSource: (id: string, body: { label?: string; baseUrl?: string; apiFormat?: ApiFormat; apiKey?: string }) =>
    request<Source>("PATCH", `/api/sources/${id}`, body),
  removeSource: (id: string) => request<void>("DELETE", `/api/sources/${id}`),
  testSource: (id: string) =>
    request<{ ok: boolean; models?: number; error?: string }>("POST", `/api/sources/${id}/test`),
  refreshCatalog: (id: string) => request<{ count: number }>("POST", `/api/sources/${id}/catalog`),
  catalog: (id: string) => request<CatalogEntry[]>("GET", `/api/sources/${id}/catalog`),

  models: () => request<Model[]>("GET", "/api/models"),
  addModel: (body: ModelInput & { sourceId: string; modelId: string }) => request<Model>("POST", "/api/models", body),
  updateModel: (id: string, body: ModelInput) => request<Model>("PATCH", `/api/models/${id}`, body),
  removeModel: (id: string) => request<void>("DELETE", `/api/models/${id}`),

  tasks: () => request<TaskRoute[]>("GET", "/api/tasks"),
  setTask: (task: AiTask, modelIds: string[]) => request<TaskRoute>("PUT", `/api/tasks/${task}`, { modelIds }),

  usage: (days: number) => request<Usage>("GET", `/api/usage?days=${days}`),
};
