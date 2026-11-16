/**
 * Aturan Akasha → Akai (gateway model ekosistem, docs/AKAI.md §5 langkah 6a.4). Logika murni, diuji di akai-logic.spec.ts.
 * Akasha memakai Akai untuk sebuah tugas hanya bila akun (sub SSO) sudah mengatur model untuk tugas itu di Akai; bila belum,
 * pengaturan lama Pengaturan → Model AI tetap dipakai.
 */
import type { AiAttachment } from "../ai/providers/ai-client";
import type { AiTask } from "../ai/ai-routing";

/** Tugas Akasha yang dijawab lewat Akai (nama tugas sama di Akai). Agen (Hermes) & embedding tetap jalur lama dulu. */
const AKAI_TASKS = new Set<AiTask>(["chat", "general", "document", "ocr"]);

export const akaiTaskFor = (task: AiTask): AiTask | null => (AKAI_TASKS.has(task) ? task : null);

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

/** Pesan galat Akai yang aman ditampilkan (Akai sudah menerjemahkan galat sumber model). */
export function akaiMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  const text = Array.isArray(message) ? message.join(" ") : typeof message === "string" ? message : "";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return clean ? `Akai: ${clean}` : `Akai menjawab galat ${status}.`;
}
