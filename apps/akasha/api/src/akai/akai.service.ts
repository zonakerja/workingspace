import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Readable } from "node:stream";
import type { Response as ExpressResponse } from "express";
import { Agent } from "undici";
import { type AiAttachment, AiProviderError } from "../ai/ai-errors";
import type { AiTask } from "../ai/ai-routing";
import {
  akaiEmbeddingModel,
  agentGatewayBody,
  agentUsage,
  akaiMessage,
  type AkaiTask,
  akaiTaskFor,
  completionText,
  embeddingResult,
  parsePrimaryModels,
  parseStatus,
  toAkaiMessages,
} from "./akai-logic";

/** Status model per tugas di Akai di-cache sebentar (Pengaturan di Akai web berlaku ≤ 30 dtk kemudian). */
const STATUS_TTL_MS = 30_000;
/**
 * `fetch` Node memutus permintaan yang menunggu header > 5 menit (undici `headersTimeout`). Akai menjawab non-stream (dan Claude lewat
 * format Anthropic) baru setelah model selesai, jadi panggilan panjang memakai dispatcher tanpa batas header/body — batasnya
 * `AbortSignal` masing-masing.
 */
const LONG_CALLS = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
/** Ringkasan transkrip panjang (± 30 rb token) bisa makan 4+ menit; Akai sendiri membatasi 10 menit per model. */
const CHAT_TIMEOUT_MS = 12 * 60_000;
const EMBED_TIMEOUT_MS = 120_000;
/** Satu giliran agen bisa panjang (pemikiran + jawaban); Akai sendiri membatasi 10 menit per model. */
const AGENT_TIMEOUT_MS = 30 * 60_000;

/** Mengunggah audio ratusan MB lewat jaringan internal. */
const TRANSCRIBE_UPLOAD_TIMEOUT_MS = 15 * 60_000;
export const AKAI_REQUIRED =
  "AI belum diatur: fitur AI memakai model yang diatur di Akai. Masuk lewat akun Workingspace dan atur model di Akai → Model.";

export type AkaiTranscribeJob =
  | { status: "running"; startedAt: number }
  | {
      status: "done";
      startedAt: number;
      finishedAt: number;
      result: {
        text: string;
        truncated: boolean;
        passes: number;
        warning: string | null;
        provider: string;
        model: string;
      };
    }
  | { status: "failed"; startedAt: number; finishedAt: number; httpStatus: number; message: string };

/** Hasil proxy agen untuk status "Panggilan model terakhir" (Siapkan agen). */
export interface AgentProxyResult {
  ok: boolean;
  unreachable?: boolean;
  model: string | null;
  fallbackFrom: string | null;
  usage: ReturnType<typeof agentUsage>;
  error?: string;
}

/** Satu baris SSE (`data: {...}`) atau JSON utuh → token bila memuat `usage`. */
function usageOfLine(line: string) {
  const text = line.startsWith("data: ") ? line.slice(6) : line;
  if (!text.includes('"usage"')) return null;
  try {
    return agentUsage((JSON.parse(text) as { usage?: unknown }).usage);
  } catch {
    return null;
  }
}
/** Teks per permintaan embedding (sama dengan jalur lama). */
const EMBED_BATCH = 50;

interface StatusInfo {
  counts: Record<string, number>;
  primary: Record<string, string>;
}

/** Akun yang dipakai memanggil Akai (Akai mengenali akun dari sub SSO). */
export interface AkaiUser {
  ssoSubject: string | null;
  email?: string | null;
  name?: string | null;
}

/** Galat dari Akai: `status` = 429 (kuota) / 422 (lainnya); `unreachable` = Akai tidak dapat dihubungi. */
export class AkaiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly unreachable = false,
  ) {
    super(message);
  }
}

/**
 * Klien Akai API untuk Akasha (server ke server: HTTP Basic klien `akasha` + `X-Akai-Subject`). Dipakai `AiService` untuk
 * tugas teks yang sudah diatur pemilik di Akai web; env kosong / akun tanpa SSO = tidak pernah dipakai. docs/AKAI.md §4.
 */
@Injectable()
export class AkaiService {
  private readonly logger = new Logger(AkaiService.name);
  private readonly baseUrl?: string;
  private readonly auth?: string;
  readonly webUrl: string | null;
  private readonly statusCache = new Map<string, { at: number; value: StatusInfo | null }>();

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("AKAI_URL")?.replace(/\/+$/, "");
    const secret = config.get<string>("AKAI_CLIENT_SECRET");
    const id = config.get<string>("AKAI_CLIENT_ID") ?? "akasha";
    if (this.baseUrl && secret) this.auth = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
    this.webUrl = config.get<string>("AKAI_WEB_URL")?.replace(/\/+$/, "") ?? null;
  }

  get enabled() {
    return !!this.auth;
  }

  private headers(user: AkaiUser): Record<string, string> {
    return {
      Authorization: this.auth!,
      "X-Akai-Subject": user.ssoSubject!,
      ...(user.email ? { "X-Akai-Email": user.email } : {}),
      // Header HTTP hanya ASCII: nama beraksen diganti agar tidak ditolak fetch
      ...(user.name ? { "X-Akai-Name": user.name.replace(/[^\x20-\x7e]/g, "?").slice(0, 200) } : {}),
    };
  }

  /**
   * Jumlah model per tugas milik akun di Akai, atau null (Akai tidak aktif / akun tanpa SSO / Akai tidak dapat dihubungi).
   * `fresh` = abaikan cache (halaman Pengaturan).
   */
  async status(user: AkaiUser, fresh = false): Promise<Record<string, number> | null> {
    return (await this.statusInfo(user, fresh))?.counts ?? null;
  }

  private async statusInfo(user: AkaiUser, fresh = false): Promise<StatusInfo | null> {
    if (!this.enabled || !user.ssoSubject) return null;
    const cached = this.statusCache.get(user.ssoSubject);
    if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
    let value: StatusInfo | null = null;
    try {
      const res = await fetch(`${this.baseUrl}/gateway/v1/status`, {
        headers: this.headers(user),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body: unknown = await res.json();
        value = { counts: parseStatus(body), primary: parsePrimaryModels(body) };
      } else this.logger.warn(`Status Akai ${res.status}`);
    } catch (error) {
      this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
    }
    this.statusCache.set(user.ssoSubject, { at: Date.now(), value });
    if (this.statusCache.size > 5000) this.statusCache.clear();
    return value;
  }

  /** Fitur AI umum bisa dipakai lewat Akai (tugas Umum atau Chat sudah punya model) — penanda `aiViaAkai` user. */
  async ready(user: AkaiUser): Promise<boolean> {
    const status = await this.status(user);
    return !!status && ((status.general ?? 0) > 0 || (status.chat ?? 0) > 0);
  }

  /** Tugas ini dijawab lewat Akai? (akun sudah mengatur model untuk tugas itu di Akai) */
  async handles(user: AkaiUser, task: AkaiTask): Promise<boolean> {
    const akaiTask = akaiTaskFor(task);
    if (!akaiTask) return false;
    const status = await this.status(user);
    return !!status && (status[akaiTask] ?? 0) > 0;
  }

  /**
   * Nama model vektor indeks bila tugas `embedding` akun diatur di Akai (`akai/<ID model utama>`), selain itu null.
   * Mengganti model utama di Akai = nama berubah → potongan lama dianggap berubah dan di-embed ulang (Indeks ulang).
   */
  async embeddingModel(user: AkaiUser): Promise<string | null> {
    const primary = await this.primaryModel(user, "embedding");
    return primary ? akaiEmbeddingModel(primary) : null;
  }

  /** ID model utama sebuah tugas di Akai (null = tugas belum diatur / Akai tidak terjangkau). */
  async primaryModel(user: AkaiUser, task: AkaiTask): Promise<string | null> {
    const info = await this.statusInfo(user);
    return (info && (info.counts[task] ?? 0) > 0 && info.primary[task]) || null;
  }

  /**
   * Embedding lewat gateway Akai (768 dimensi). Batch pertama memakai model tugas (Akai boleh pindah ke cadangan); batch
   * berikutnya meminta model yang menjawab batch pertama agar satu panggilan tidak mencampur ruang vektor. `model` hasil =
   * nama yang dicatat per potongan. Galat → `AiProviderError` (pola sama dengan jalur lama: kuota / tak terjangkau / lainnya).
   */
  async embed(user: AkaiUser, texts: string[], dimensions: number): Promise<{ vectors: number[][]; model: string }> {
    const vectors: number[][] = [];
    let modelId: string | null = null;
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/gateway/v1/embeddings`, {
          method: "POST",
          headers: { ...this.headers(user), "Content-Type": "application/json" },
          body: JSON.stringify({ input: batch, ...(modelId ? { model: modelId } : { task: "embedding" }) }),
          signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        });
      } catch (error) {
        this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
        throw new AiProviderError("unavailable", "Akai tidak dapat dihubungi.");
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new AiProviderError(res.status === 429 ? "quota" : "invalid", akaiMessage(body, res.status));
      const result = embeddingResult(body, batch.length, dimensions);
      if (!result) throw new AiProviderError("invalid", "Akai: jumlah/dimensi embedding tidak sesuai.");
      modelId ??= result.model;
      vectors.push(...result.vectors);
    }
    return { vectors, model: akaiEmbeddingModel(modelId ?? "") };
  }

  /**
   * Jawab prompt lewat gateway Akai (model & cadangan dipilih Akai menurut pembagian tugas akun). null = lampiran tidak bisa
   * lewat gateway (audio). Galat → `AkaiError`.
   */
  /**
   * Proxy model agen (Hermes) lewat gateway Akai: body `chat/completions` diteruskan dengan `task: "agent"` dan jawaban (stream
   * maupun JSON) ditulis apa adanya ke `res`. Akai yang memilih model, cadangan, prompt caching & blok pemikiran Claude.
   * `unreachable` = Akai tidak dapat dihubungi sebelum menjawab (pemanggil boleh memakai jalur lama); selain itu respons sudah
   * ditulis (galat Akai 422/429 diteruskan dalam format galat OpenAI).
   */
  async proxyAgent(user: AkaiUser, body: unknown, res: ExpressResponse): Promise<AgentProxyResult> {
    const payload = agentGatewayBody(body);
    if (!payload) {
      res
        .status(400)
        .json({ error: { message: "Permintaan chat tidak valid (messages kosong).", type: "akai_error" } });
      return { ok: false, model: null, fallbackFrom: null, usage: null, error: "permintaan tidak valid" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
    res.on("close", () => controller.abort());
    let upstream: Response;
    try {
      upstream = await fetch(`${this.baseUrl}/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(user), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        dispatcher: LONG_CALLS,
      } as RequestInit);
    } catch (error) {
      clearTimeout(timer);
      this.logger.warn(`Akai tidak dapat dihubungi (agen): ${String(error)}`);
      return {
        ok: false,
        unreachable: true,
        model: null,
        fallbackFrom: null,
        usage: null,
        error: "Akai tidak dapat dihubungi",
      };
    }
    const decode = (value: string | null) => (value ? decodeURIComponent(value) : null);
    const model = decode(upstream.headers.get("x-akai-model"));
    const fallbackFrom = decode(upstream.headers.get("x-akai-fallback-from"));
    try {
      if (!upstream.ok || !upstream.body) {
        const data: unknown = await upstream.json().catch(() => null);
        const message = akaiMessage(data, upstream.status);
        res
          .status(upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 422)
          .json({ error: { message, type: "akai_error" } });
        return { ok: false, model, fallbackFrom, usage: null, error: message };
      }
      res.status(200);
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.setHeader("Cache-Control", "no-cache");
      // Teruskan apa adanya; potongan berisi `usage` dibaca untuk status Siapkan agen (token & cache)
      let usage: AgentProxyResult["usage"] = null;
      let pending = "";
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) usage = usageOfLine(line) ?? usage;
      }
      usage = usageOfLine(pending) ?? usage;
      res.end();
      return { ok: true, model, fallbackFrom, usage };
    } catch (error) {
      // Koneksi putus di tengah jawaban: tutup apa adanya (Hermes mengulang sendiri)
      if (!res.headersSent) res.status(422).json({ error: { message: "Akai memutus jawaban.", type: "akai_error" } });
      else res.end();
      return { ok: false, model, fallbackFrom, usage: null, error: String(error).slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Galat jawaban Akai → AkaiError (429 kuota / 400 isian / 422 lainnya). */
  private async fail(res: Response): Promise<never> {
    const body: unknown = await res.json().catch(() => null);
    throw new AkaiError(res.status === 429 ? 429 : res.status === 400 ? 400 : 422, akaiMessage(body, res.status));
  }

  private unreachable(error: unknown): never {
    this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
    throw new AkaiError(422, "Akai tidak dapat dihubungi. Coba lagi sebentar.", true);
  }

  /**
   * Mulai transkrip audio di Akai: isi audio dialirkan (bukan dimuat ke memori), `key` = kunci pekerjaan (ID berkas). Akai
   * mengerjakannya di latar belakang memakai model tugas Transkrip (Gemini langsung).
   */
  async transcribeStart(user: AkaiUser, key: string, mimeType: string, audio: Readable, size: number) {
    if (!this.enabled || !user.ssoSubject) throw new AkaiError(422, AKAI_REQUIRED);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/gateway/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          ...this.headers(user),
          "Content-Type": mimeType,
          "Content-Length": String(size),
          "X-Akai-Key": key,
        },
        body: audio as unknown as BodyInit,
        duplex: "half",
        signal: AbortSignal.timeout(TRANSCRIBE_UPLOAD_TIMEOUT_MS),
        dispatcher: LONG_CALLS,
      } as RequestInit);
    } catch (error) {
      this.unreachable(error);
    }
    if (!res.ok) await this.fail(res);
    return (await res.json()) as AkaiTranscribeJob;
  }

  /** Status transkrip di Akai (null = Akai tidak mengenal pekerjaan ini, mis. Akai baru dimulai ulang). */
  async transcribeStatus(user: AkaiUser, key: string): Promise<AkaiTranscribeJob | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/gateway/v1/audio/transcriptions/${encodeURIComponent(key)}`, {
        headers: this.headers(user),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.unreachable(error);
    }
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res);
    return (await res.json()) as AkaiTranscribeJob;
  }

  async generate(user: AkaiUser, task: AiTask, prompt: string, attachments: AiAttachment[]) {
    const messages = toAkaiMessages(prompt, attachments);
    if (!messages) return null;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(user), "Content-Type": "application/json" },
        body: JSON.stringify({ task: akaiTaskFor(task), messages }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        dispatcher: LONG_CALLS,
      } as RequestInit);
    } catch (error) {
      this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
      throw new AkaiError(422, "Akai tidak dapat dihubungi. Coba lagi sebentar.", true);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new AkaiError(res.status === 429 ? 429 : 422, akaiMessage(body, res.status));
    const text = completionText(body);
    if (!text) throw new AkaiError(422, "Akai: model tidak memberikan jawaban.");
    const decode = (value: string | null) => (value ? decodeURIComponent(value) : null);
    return {
      text,
      model: decode(res.headers.get("x-akai-model")) ?? String((body as { model?: unknown }).model ?? "akai"),
      fallbackFrom: decode(res.headers.get("x-akai-fallback-from")),
    };
  }
}
