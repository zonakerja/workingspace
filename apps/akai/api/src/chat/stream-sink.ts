/**
 * Penampung jawaban gateway untuk loop alat chat (6b.5): meniru bagian `express.Response` yang dipakai GatewayService &
 * AgentModelService, membaca stream SSE format OpenAI, meneruskan potongan teks lewat `onText`, dan mengumpulkan pemanggilan alat
 * (`delta.tool_calls` bertahap per `index`, atau utuh dari jalur native). Logika pembaca diuji di stream-sink.spec.ts.
 */

type Json = Record<string, unknown>;

export interface CollectedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class StreamSink {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  statusCode = 200;
  readonly headers = new Map<string, string>();
  text = "";
  error: string | null = null;
  usage = { input: 0, output: 0 };
  /** Jawaban non-stream (bila gateway memanggil `json`) */
  json_: Json | null = null;
  private pending = "";
  private readonly calls = new Map<number, CollectedToolCall>();
  private readonly closeHandlers: (() => void)[] = [];
  private readonly decoder = new TextDecoder();

  constructor(private readonly onText: (delta: string) => void) {}

  setHeader(name: string, value: string | number) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  flushHeaders() {
    this.headersSent = true;
  }

  on(event: string, handler: () => void) {
    if (event === "close") this.closeHandlers.push(handler);
    return this;
  }

  /** Browser memutus → hentikan panggilan model yang berjalan. */
  abort() {
    this.destroyed = true;
    for (const handler of this.closeHandlers) handler();
  }

  write(chunk: unknown) {
    this.headersSent = true;
    this.read(
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? this.decoder.decode(chunk, { stream: true })
          : "",
    );
    return true;
  }

  end(chunk?: unknown) {
    if (chunk !== undefined) this.write(chunk);
    this.read("\n");
    this.writableEnded = true;
    return this;
  }

  json(body: Json) {
    this.headersSent = true;
    this.writableEnded = true;
    this.json_ = body;
    const message = ((body.choices as Json[] | undefined)?.[0]?.message ?? {}) as Json;
    if (typeof message.content === "string" && message.content) {
      this.text += message.content;
      this.onText(message.content);
    }
    for (const [index, call] of ((message.tool_calls as Json[] | undefined) ?? []).entries()) this.addCall(index, call);
    this.addUsage(body.usage);
    return this;
  }

  get toolCalls(): CollectedToolCall[] {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c)
      .filter((c) => c.name);
  }

  private addUsage(usage: unknown) {
    const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    if (u && typeof u.prompt_tokens === "number") this.usage.input += u.prompt_tokens;
    if (u && typeof u.completion_tokens === "number") this.usage.output += u.completion_tokens;
  }

  private addCall(index: number, raw: Json) {
    const fn = (raw.function ?? {}) as Json;
    const current = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
    if (typeof raw.id === "string" && raw.id) current.id = raw.id;
    if (typeof fn.name === "string") current.name += fn.name;
    if (typeof fn.arguments === "string") current.arguments += fn.arguments;
    this.calls.set(index, current);
  }

  private read(chunk: string) {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      let data: Json;
      try {
        data = JSON.parse(line.slice(6)) as Json;
      } catch {
        continue;
      }
      if (data.error) {
        const err = data.error as Json;
        this.error = typeof err.message === "string" ? err.message : "Model gagal menjawab.";
      }
      const delta = (((data.choices as Json[] | undefined)?.[0]?.delta ?? {}) as Json) || {};
      if (typeof delta.content === "string" && delta.content) {
        this.text += delta.content;
        this.onText(delta.content);
      }
      for (const raw of (delta.tool_calls as Json[] | undefined) ?? []) {
        const index = typeof raw.index === "number" ? raw.index : this.calls.size;
        this.addCall(index, raw);
      }
      if (data.usage) this.addUsage(data.usage);
    }
  }
}
