/** Klien chat Akai (6b.1, docs/AKAI.md §8) + logika murni tampilan (diuji di chat.test.ts). */
import { ApiError, request } from "./api";

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  modelId: string | null;
  projectId?: string | null;
  /** Hasil tugas terjadwal yang belum dibuka */
  unread?: boolean;
  scheduledTaskId?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: AttachmentRef[] | null;
  model: string | null;
  fallbackFrom: string | null;
  error: string | null;
  /** Alat konektor yang dipakai jawaban ini (6b.5) */
  toolRuns?: ToolRun[] | null;
  /** Perubahan memori dari pertukaran ini (6b.3), terisi beberapa detik setelah jawaban */
  memoryUpdates?: { op: "add" | "remove"; content: string }[] | null;
  createdAt: string;
}

export interface ToolRun {
  id: string;
  connector: string;
  tool: string;
  title: string | null;
  status: "running" | "done" | "error";
  input: string;
  output: string | null;
}

export interface Conversation extends ConversationSummary {
  project?: { id: string; name: string } | null;
  messages: ChatMessage[];
}

export interface UploadedAttachment extends AttachmentRef {
  kind: "image" | "pdf" | "text";
}

export const chatApi = {
  list: (q?: string) =>
    request<ConversationSummary[]>("GET", `/api/chat/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  create: (modelId?: string | null, projectId?: string | null) =>
    request<ConversationSummary>("POST", "/api/chat/conversations", { modelId, projectId }),
  get: (id: string) => request<Conversation>("GET", `/api/chat/conversations/${id}`),
  update: (
    id: string,
    body: { title?: string; pinned?: boolean; modelId?: string | null; projectId?: string | null },
  ) => request<ConversationSummary>("PATCH", `/api/chat/conversations/${id}`, body),
  remove: (id: string) => request<void>("DELETE", `/api/chat/conversations/${id}`),
  async upload(file: File): Promise<UploadedAttachment> {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/chat/attachments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Akai-Web": "1" },
        body: form,
      });
    } catch {
      throw new ApiError(0, "Server Akai tidak dapat dihubungi.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, errorMessage(data, "Lampiran gagal diunggah."));
    return data as UploadedAttachment;
  },
  attachmentUrl: (id: string) => `/api/chat/attachments/${id}`,
};

function errorMessage(body: unknown, fallback: string) {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.map(String).join(" ");
  return typeof message === "string" && message ? message : fallback;
}

export interface StreamResult {
  ok: boolean;
  error?: string;
  aborted?: boolean;
}

/**
 * Kirim pesan lalu baca jawaban stream (SSE format OpenAI). `onText` dipanggil dengan teks gabungan setiap potongan baru.
 * Galat sebelum stream (kuota, model belum diatur) dikembalikan sebagai `error`.
 */
export async function streamMessage(
  conversationId: string,
  body: { content?: string; attachmentIds?: string[]; regenerate?: boolean },
  onText: (text: string, tools: ToolRun[]) => void,
  signal: AbortSignal,
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Akai-Web": "1", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return { ok: false, aborted: true };
    void error;
    return { ok: false, error: "Server Akai tidak dapat dihubungi." };
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    return { ok: false, error: errorMessage(data, "Akai gagal menjawab.") };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const state = newSseState();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (readSse(state, decoder.decode(value, { stream: true }))) onText(state.text, state.tools);
    }
  } catch {
    if (signal.aborted) return { ok: false, aborted: true };
    return { ok: false, error: "Jawaban terputus." };
  }
  if (state.error) return { ok: false, error: state.error };
  return { ok: true };
}

export interface SseState {
  text: string;
  pending: string;
  error: string | null;
  /** Jejak alat (event `akai_tool`), diperbarui per id */
  tools: ToolRun[];
}

export const newSseState = (): SseState => ({ text: "", pending: "", error: null, tools: [] });

/** Baca potongan SSE: tambahkan `delta.content`; `{ error }` (galat di tengah stream) dicatat. true = teks berubah. */
export function readSse(state: SseState, chunk: string): boolean {
  state.pending += chunk;
  const lines = state.pending.split("\n");
  state.pending = lines.pop() ?? "";
  let changed = false;
  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const data = JSON.parse(line.slice(6)) as {
        choices?: { delta?: { content?: unknown } }[];
        error?: { message?: unknown };
        akai_tool?: ToolRun;
      };
      if (data.akai_tool?.id) {
        const run = data.akai_tool;
        state.tools = state.tools.some((t) => t.id === run.id)
          ? state.tools.map((t) => (t.id === run.id ? run : t))
          : [...state.tools, run];
        changed = true;
      }
      const content = data.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) {
        state.text += content;
        changed = true;
      }
      if (data.error && typeof data.error.message === "string") state.error = data.error.message;
    } catch {
      // potongan bukan JSON lengkap
    }
  }
  return changed;
}

export type ConversationGroup = { label: string; items: ConversationSummary[] };

/** Riwayat di sidebar: Disematkan, Hari ini, Kemarin, 7 hari terakhir, 30 hari terakhir, Lebih lama. */
export function groupConversations(items: ConversationSummary[], now = new Date()): ConversationGroup[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: [string, (t: number) => boolean][] = [
    ["Hari ini", (t) => t >= start],
    ["Kemarin", (t) => t >= start - day],
    ["7 hari terakhir", (t) => t >= start - 7 * day],
    ["30 hari terakhir", (t) => t >= start - 30 * day],
    ["Lebih lama", () => true],
  ];
  const groups: ConversationGroup[] = [];
  const pinned = items.filter((c) => c.pinned);
  if (pinned.length) groups.push({ label: "Disematkan", items: pinned });
  for (const [label, test] of buckets) {
    const taken = new Set(groups.flatMap((g) => g.items.map((c) => c.id)));
    const list = items.filter((c) => !taken.has(c.id) && test(new Date(c.updatedAt).getTime()));
    if (list.length) groups.push({ label, items: list });
  }
  return groups;
}

export const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
