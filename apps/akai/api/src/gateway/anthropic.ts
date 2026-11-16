/**
 * Terjemahan OpenAI Chat Completions ↔ Anthropic Messages untuk sumber berformat Anthropic (Claude resmi / router Anthropic).
 * Logika murni, diuji di anthropic.spec.ts. Cakupan gateway 6a.2: teks, gambar, alat; blok pemikiran & prompt caching
 * menyusul di loop agen (6c).
 */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

export const DEFAULT_MAX_TOKENS = 8192;

type Block = Json;

/** Isi pesan OpenAI (string / bagian) → blok Anthropic. */
function contentBlocks(content: unknown): Block[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    if (part.type === "text" && typeof part.text === "string") blocks.push({ type: "text", text: part.text });
    if (part.type === "image_url") {
      const url = isObject(part.image_url) ? String(part.image_url.url ?? "") : String(part.image_url ?? "");
      const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
      if (data) blocks.push({ type: "image", source: { type: "base64", media_type: data[1], data: data[2] } });
      else if (/^https?:\/\//.test(url)) blocks.push({ type: "image", source: { type: "url", url } });
    }
    // Berkas format OpenAI `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,…" } }` → blok dokumen
    if (part.type === "file" && isObject(part.file)) {
      const data = /^data:application\/pdf;base64,(.*)$/s.exec(String(part.file.file_data ?? ""));
      if (data)
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: data[1] } });
    }
  }
  return blocks;
}

const textOf = (content: unknown) =>
  contentBlocks(content)
    .filter((b) => b.type === "text")
    .map((b) => b.text as string)
    .join("\n");

/** Gabungkan pesan berurutan dengan peran sama (Anthropic mewajibkan user/assistant bergantian). */
function pushMessage(messages: { role: string; content: Block[] }[], role: "user" | "assistant", blocks: Block[]) {
  if (blocks.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) last.content.push(...blocks);
  else messages.push({ role, content: [...blocks] });
}

/** Body OpenAI Chat Completions → body Anthropic Messages (`model` = id model di sumber). */
export function toAnthropic(body: Json, model: string): Json {
  const system: string[] = [];
  const messages: { role: string; content: Block[] }[] = [];
  for (const raw of Array.isArray(body.messages) ? body.messages : []) {
    if (!isObject(raw)) continue;
    const role = String(raw.role);
    if (role === "system" || role === "developer") {
      const text = textOf(raw.content);
      if (text) system.push(text);
    } else if (role === "user") {
      pushMessage(messages, "user", contentBlocks(raw.content));
    } else if (role === "assistant") {
      const blocks = contentBlocks(raw.content);
      for (const call of Array.isArray(raw.tool_calls) ? raw.tool_calls : []) {
        if (!isObject(call) || !isObject(call.function)) continue;
        let input: unknown;
        try {
          input = JSON.parse(String(call.function.arguments ?? "{}"));
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: String(call.id), name: String(call.function.name), input });
      }
      pushMessage(messages, "assistant", blocks);
    } else if (role === "tool") {
      pushMessage(messages, "user", [
        { type: "tool_result", tool_use_id: String(raw.tool_call_id), content: textOf(raw.content) },
      ]);
    }
  }
  const out: Json = {
    model,
    messages,
    max_tokens:
      typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : typeof body.max_tokens === "number"
          ? body.max_tokens
          : DEFAULT_MAX_TOKENS,
  };
  if (system.length) out.system = system.join("\n\n");
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  if (Array.isArray(body.stop) || typeof body.stop === "string")
    out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter((t) => isObject(t) && isObject(t.function))
      .map((t) => {
        const fn = (t as Json).function as Json;
        return {
          name: fn.name,
          ...(fn.description ? { description: fn.description } : {}),
          input_schema: isObject(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
        };
      });
    const choice = body.tool_choice;
    if (choice === "required") out.tool_choice = { type: "any" };
    else if (choice === "none") out.tool_choice = { type: "none" };
    else if (isObject(choice) && isObject(choice.function))
      out.tool_choice = { type: "tool", name: choice.function.name };
  }
  return out;
}

const FINISH: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

/** Jawaban Anthropic Messages → `chat.completion` OpenAI (model = id model Akai yang dipakai). */
export function fromAnthropic(message: Json, model: string, created: number): Json {
  const blocks = Array.isArray(message.content) ? (message.content as Json[]) : [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("");
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
  const usage = isObject(message.usage) ? message.usage : {};
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  const input = Number(usage.input_tokens ?? 0) + cacheRead + cacheWrite;
  return {
    id: `chatcmpl-${String(message.id ?? created)}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        finish_reason: FINISH[String(message.stop_reason)] ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: input,
      completion_tokens: Number(usage.output_tokens ?? 0),
      total_tokens: input + Number(usage.output_tokens ?? 0),
      prompt_tokens_details: { cached_tokens: cacheRead },
    },
  };
}

/**
 * Jawaban lengkap → event SSE `chat.completion.chunk` (aplikasi meminta stream dari sumber Anthropic: jawaban dikirim
 * sekaligus dalam format stream, isi sama).
 */
export function completionAsSse(completion: Json): string {
  const choice = (completion.choices as Json[])[0];
  const message = choice.message as Json;
  const base = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
  };
  const delta: Json = { role: "assistant", content: message.content ?? "" };
  if (Array.isArray(message.tool_calls))
    delta.tool_calls = (message.tool_calls as Json[]).map((call, index) => ({ index, ...call }));
  const events = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage: completion.usage },
  ];
  return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
}
