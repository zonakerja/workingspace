/**
 * Aturan Akasha → Akai (gateway model ekosistem, docs/AKAI.md §5 langkah 6a.4). Logika murni, diuji di akai-logic.spec.ts.
 * Akasha memakai Akai untuk sebuah tugas hanya bila akun (sub SSO) sudah mengatur model untuk tugas itu di Akai; bila belum,
 * pengaturan lama Pengaturan → Model AI tetap dipakai.
 */
import type { AiAttachment } from "../ai/ai-errors";
import type { AiTask } from "../ai/ai-routing";

/** Tugas yang bisa dijawab lewat Akai: tugas teks Akasha + `embedding` (indeks pengetahuan). Nama tugas sama di Akai. */
export type AkaiTask = AiTask | "embedding";

/** Agen (Hermes) lewat proxy model Akasha → gateway Akai (`AgentService.proxyChat`). */
const AKAI_TASKS = new Set<AkaiTask>(["chat", "general", "document", "ocr", "embedding", "agent"]);

export const akaiTaskFor = (task: AkaiTask): AkaiTask | null => (AKAI_TASKS.has(task) ? task : null);

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/**
 * Prompt + lampiran → pesan format OpenAI Chat Completions. Teks dilampirkan sebagai teks, gambar sebagai `image_url`,
 * PDF sebagai `file` (base64). Audio tidak bisa lewat gateway → null (pemanggil memakai jalur lama).
 */
export function toAkaiMessages(prompt: string, attachments: AiAttachment[]) {
  if (attachments.some((a) => a.kind === "audio")) return null;
  if (attachments.length === 0) return [{ role: "user", content: prompt }];
  const parts: ContentPart[] = [];
  for (const a of attachments) {
    const base64 = a.data.toString("base64");
    if (a.kind === "image")
      parts.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${base64}` } });
    else if (a.kind === "pdf")
      parts.push({ type: "file", file: { filename: a.name, file_data: `data:application/pdf;base64,${base64}` } });
    else parts.push({ type: "text", text: `<berkas nama="${a.name}">\n${a.data.toString("utf8")}\n</berkas>` });
  }
  parts.push({ type: "text", text: prompt });
  return [{ role: "user", content: parts }];
}

/** Teks jawaban `chat.completion` (null bila kosong / bentuk tak dikenal). */
export function completionText(body: unknown): string | null {
  const choices = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  if (typeof content === "string") return content.trim() ? content : null;
  if (Array.isArray(content)) {
    const text = content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : "",
      )
      .join("");
    return text.trim() ? text : null;
  }
  return null;
}

/** `GET /gateway/v1/status` → jumlah model per tugas. */
export function parseStatus(body: unknown): Record<string, number> {
  const tasks = (body as { tasks?: unknown } | null)?.tasks;
  const result: Record<string, number> = {};
  if (!Array.isArray(tasks)) return result;
  for (const t of tasks) {
    const task = (t as { task?: unknown }).task;
    const models = (t as { models?: unknown }).models;
    if (typeof task === "string" && typeof models === "number") result[task] = models;
  }
  return result;
}

/** `GET /gateway/v1/status` → ID model utama per tugas (tugas tanpa model tidak dimuat). */
export function parsePrimaryModels(body: unknown): Record<string, string> {
  const tasks = (body as { tasks?: unknown } | null)?.tasks;
  const result: Record<string, string> = {};
  if (!Array.isArray(tasks)) return result;
  for (const t of tasks) {
    const task = (t as { task?: unknown }).task;
    const primary = (t as { primary?: unknown }).primary;
    if (typeof task === "string" && typeof primary === "string" && primary) result[task] = primary;
  }
  return result;
}

/**
 * Nama model yang dicatat per potongan indeks (`ai_chunks.model`) untuk vektor dari Akai. Diberi awalan agar tidak pernah
 * dianggap sama dengan vektor jalur lama (`gemini-embedding-2` langsung): pencarian hanya membandingkan model yang sama.
 */
export const akaiEmbeddingModel = (modelId: string) => `akai/${modelId}`;

/**
 * Jawaban `POST /gateway/v1/embeddings` → vektor urut `index` + ID model yang menjawab. null bila jumlah / dimensi tidak
 * sesuai (Akai sudah memeriksa dimensi, ini penjaga kedua).
 */
export function embeddingResult(body: unknown, expected: number, dimensions: number) {
  const json = body as { data?: unknown; model?: unknown } | null;
  if (!json || !Array.isArray(json.data) || typeof json.model !== "string") return null;
  const rows = json.data as { index?: unknown; embedding?: unknown }[];
  const vectors = [...rows]
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((d) => (Array.isArray(d.embedding) ? (d.embedding as number[]) : []));
  if (
    vectors.length !== expected ||
    vectors.some((v) => v.length !== dimensions || v.some((x) => typeof x !== "number"))
  )
    return null;
  return { vectors, model: json.model };
}

/**
 * Body `chat/completions` dari Hermes → body untuk gateway Akai: tugas `agent` (Akai memilih model & cadangan), nama model Hermes
 * (`akasha-agent`) dibuang agar Akai tidak mencarinya sebagai model. Null bila bukan permintaan chat.
 */
export function agentGatewayBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = { ...(body as Record<string, unknown>) };
  if (!Array.isArray(input.messages) || input.messages.length === 0) return null;
  delete input.model;
  return { ...input, task: "agent" };
}

/** Token dari `usage` format OpenAI yang dikirim Akai (Claude: cache baca/tulis ikut dilaporkan). */
export function agentUsage(usage: unknown) {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cacheRead = num(u.cache_read_input_tokens) || num(details.cached_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  // prompt_tokens mencakup bagian cache → masukan baru = sisanya (sama dengan tampilan jalur langsung)
  return {
    input: Math.max(0, num(u.prompt_tokens) - cacheRead - cacheWrite),
    output: num(u.completion_tokens),
    cacheRead,
    cacheWrite,
  };
}

/** Pesan galat Akai yang aman ditampilkan (Akai sudah menerjemahkan galat sumber model). */
export function akaiMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  const text = Array.isArray(message) ? message.join(" ") : typeof message === "string" ? message : "";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return clean ? `Akai: ${clean}` : `Akai menjawab galat ${status}.`;
}
