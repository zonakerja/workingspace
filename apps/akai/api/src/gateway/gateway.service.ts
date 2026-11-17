import { HttpException, Injectable, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { Caller } from "../common/caller";
import { type AiModel, type AiSource, ApiFormat, SourceKind } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AgentModelService } from "./agent-model.service";
import { SourcesService } from "../sources/sources.service";
import { AI_TASKS, type AiTask, TASK_LABELS } from "../sources/task-logic";
import { completionAsSse, fromAnthropic, toAnthropic } from "./anthropic";
import {
  type TokenUsage,
  callerStatus,
  estimateCost,
  isFallbackStatus,
  needsTools,
  needsPdf,
  needsVision,
  upstreamMessage,
  UpstreamFailure,
  usageFromOpenAi,
  withoutOpenAiOnlyKeys,
} from "./gateway-logic";

type Json = Record<string, unknown>;
type Candidate = AiModel & { source: AiSource };

/** Batas waktu satu panggilan model (jawaban panjang / model bernalar). */
const CHAT_TIMEOUT_MS = 5 * 60_000;
const EMBED_TIMEOUT_MS = 60_000;
export const EMBEDDING_DIMENSIONS = 768;

/** Galat yang sudah berbentuk jawaban untuk aplikasi (429 / 422 + pesan). */
class GatewayError extends HttpException {
  constructor(
    status: number,
    message: string,
    readonly upstream?: number,
  ) {
    super({ statusCode: status, message }, status);
  }
}

/** Gateway model untuk aplikasi ekosistem (docs/AKAI.md §4): pembagian tugas + cadangan, OpenAI ↔ Anthropic, log pemakaian. */
@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly agent: AgentModelService,
  ) {
    this.agent.outbound = this.sources.outbound;
  }

  /** Model untuk permintaan: `model` (id model Akai / id di sumber) = satu model tanpa cadangan; selain itu tugas. */
  private async candidates(accountId: string, body: Json): Promise<{ task: AiTask | null; list: Candidate[] }> {
    if (typeof body.model === "string" && body.model.trim()) {
      const wanted = body.model.trim();
      const model = await this.prisma.aiModel.findFirst({
        where: { accountId, enabled: true, OR: [{ id: wanted }, { modelId: wanted }] },
        include: { source: true },
      });
      if (!model) throw new GatewayError(422, `Model "${wanted.slice(0, 100)}" belum dinyalakan di Akai.`);
      return { task: null, list: [model] };
    }
    const task = (typeof body.task === "string" ? body.task : "general") as AiTask;
    if (!AI_TASKS.includes(task)) throw new GatewayError(422, "Tugas tidak dikenal.");
    const route = await this.prisma.aiTaskRoute.findUnique({ where: { accountId_task: { accountId, task } } });
    const ids = (route?.modelIds as string[] | undefined) ?? [];
    const models = await this.prisma.aiModel.findMany({
      where: { accountId, id: { in: ids }, enabled: true },
      include: { source: true },
    });
    const list = ids.map((id) => models.find((m) => m.id === id)).filter((m): m is Candidate => !!m);
    if (list.length === 0)
      throw new GatewayError(422, `Belum ada model untuk tugas "${TASK_LABELS[task]}". Atur di Akai → Model.`);
    return { task, list };
  }

  private async log(
    caller: Caller,
    task: AiTask | null,
    model: Candidate | null,
    data: Partial<Json> & { ok: boolean },
  ) {
    const usage = (data.usage as TokenUsage | undefined) ?? { input: null, output: null, cached: null };
    const { cost, currency } = model ? estimateCost(usage, model) : { cost: null, currency: null };
    await this.prisma.aiUsage
      .create({
        data: {
          accountId: caller.account.id,
          clientId: caller.clientId,
          task,
          modelId: model?.id ?? null,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cachedTokens: usage.cached,
          cost,
          currency,
          durationMs: typeof data.durationMs === "number" ? Math.round(data.durationMs) : null,
          ok: data.ok,
          fallbackFrom: (data.fallbackFrom as string | undefined) ?? null,
          error: typeof data.error === "string" ? data.error.slice(0, 500) : null,
        },
      })
      .catch((error: unknown) => this.logger.warn(`Catat pemakaian gagal: ${String(error)}`));
  }

  private async fetchJson(url: string, init: RequestInit, timeoutMs: number) {
    let res: globalThis.Response;
    try {
      res = await this.sources.outbound(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch (error) {
      throw new UpstreamFailure(503, `Sumber model tidak dapat dihubungi (${String(error).slice(0, 120)}).`, true);
    }
    return res;
  }

  private async failure(res: globalThis.Response): Promise<UpstreamFailure> {
    const body = await res.json().catch(() => null);
    return new UpstreamFailure(res.status, upstreamMessage(res.status, body), isFallbackStatus(res.status));
  }

  /** Satu panggilan chat ke satu model. Stream OpenAI diteruskan langsung ke `res` (setelah header terkirim tidak ada cadangan). */
  private async callChat(
    caller: Caller,
    task: AiTask | null,
    model: Candidate,
    body: Json,
    res: Response,
  ): Promise<{ usage: TokenUsage; streamed: boolean; json?: Json }> {
    const { baseUrl, format, apiKey } = this.sources.endpointOf(model.source);
    const stream = body.stream === true;
    // Tugas Agen: jalur native (prompt caching & pemikiran Claude, Responses API OpenAI) — AgentModelService
    // akai_native = permintaan internal Akai (chat beralat) yang juga butuh jalur native (cache, pemikiran, alat)
    const native = task === "agent" || body.akai_native === true;
    body = { ...body };
    delete body.akai_native;
    if (native) {
      const payload: Json = { ...body };
      delete payload.task;
      if (format === ApiFormat.anthropic)
        return this.agent.claude(caller.account.id, model, { baseUrl, apiKey }, payload, res);
      if (model.source.kind === SourceKind.openai)
        return this.agent.openaiResponses(model, { baseUrl, apiKey }, payload, res);
    }
    if (format === ApiFormat.anthropic) {
      const upstream = await this.fetchJson(
        `${baseUrl}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(toAnthropic(body, model.modelId)),
        },
        CHAT_TIMEOUT_MS,
      );
      if (!upstream.ok) throw await this.failure(upstream);
      const completion = fromAnthropic((await upstream.json()) as Json, model.modelId, Math.floor(Date.now() / 1000));
      const usage = usageFromOpenAi(completion.usage);
      if (stream) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(completionAsSse(completion));
        return { usage, streamed: true };
      }
      return { usage, streamed: false, json: completion };
    }

    const payload: Json = {
      ...(task === "agent" && model.source.kind !== SourceKind.openai ? withoutOpenAiOnlyKeys(body) : body),
      model: model.modelId,
    };
    delete payload.task;
    if (stream) payload.stream_options = { include_usage: true };
    const upstream = await this.fetchJson(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      },
      CHAT_TIMEOUT_MS,
    );
    if (!upstream.ok) throw await this.failure(upstream);
    if (!stream) {
      const json = (await upstream.json()) as Json;
      return { usage: usageFromOpenAi(json.usage), streamed: false, json };
    }
    // Stream: teruskan apa adanya, ambil usage dari potongan terakhir (stream_options.include_usage).
    // Status disetel sendiri: rute @Post Nest bawaannya 201.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    let usage: TokenUsage = { input: null, output: null, cached: null };
    let pending = "";
    const decoder = new TextDecoder();
    const reader = upstream.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || !line.includes('"usage"')) continue;
        try {
          const chunk = JSON.parse(line.slice(6)) as Json;
          if (chunk.usage) usage = usageFromOpenAi(chunk.usage);
        } catch {
          // potongan bukan JSON lengkap → abaikan
        }
      }
    }
    res.end();
    return { usage, streamed: true };
  }

  /** `POST /gateway/v1/chat/completions` — format OpenAI; `task` atau `model`; cadangan berurutan. */
  async chat(caller: Caller, body: Json, res: Response) {
    const { task, list } = await this.candidates(caller.account.id, body);
    const vision = needsVision(body.messages);
    const pdf = needsPdf(body.messages);
    const tools = needsTools(body);
    const usable = list.filter((m) => (!vision || m.vision) && (!pdf || m.pdf) && (!tools || m.tools));
    if (usable.length === 0)
      throw new GatewayError(
        422,
        vision
          ? "Tidak ada model tugas ini yang bisa membaca gambar. Nyalakan kemampuan gambar pada model di Akai."
          : pdf
            ? "Tidak ada model tugas ini yang bisa membaca PDF. Nyalakan kemampuan PDF pada model di Akai."
            : "Tidak ada model tugas ini yang mendukung alat (tools).",
      );
    let fallbackFrom: string | undefined;
    let last: UpstreamFailure | undefined;
    for (const model of usable) {
      const started = Date.now();
      // Header disetel sebelum memanggil agar ikut terkirim juga pada jawaban stream (header dikirim saat stream mulai).
      res.setHeader("X-Akai-Model", encodeURIComponent(model.label));
      if (fallbackFrom) res.setHeader("X-Akai-Fallback-From", encodeURIComponent(fallbackFrom));
      try {
        const result = await this.callChat(caller, task, model, body, res);
        await this.log(caller, task, model, {
          ok: true,
          usage: result.usage,
          durationMs: Date.now() - started,
          fallbackFrom,
        });
        if (!result.streamed) res.status(200).json({ ...result.json, model: model.modelId });
        return;
      } catch (error) {
        if (!(error instanceof UpstreamFailure)) throw error;
        last = error;
        await this.log(caller, task, model, {
          ok: false,
          error: error.message,
          durationMs: Date.now() - started,
          fallbackFrom,
        });
        // Stream sudah dimulai (potongan galat terkirim) → tidak ada jawaban lain yang bisa ditulis
        if (res.headersSent) return;
        if (!error.fallback) break;
        fallbackFrom ??= model.label;
      }
    }
    throw new GatewayError(callerStatus(last?.status ?? 500), last?.message ?? "Model tidak menjawab.", last?.status);
  }

  /**
   * Jawaban non-stream untuk pemakaian internal Akai (mis. judul percakapan chat): jalur gateway yang sama (tugas, cadangan,
   * log pemakaian) tanpa respons HTTP. Galat → `HttpException` (429/422) seperti `chat`.
   */
  async completion(caller: Caller, body: Json): Promise<Json> {
    let result: Json = {};
    const sink = {
      headersSent: false,
      setHeader: () => sink,
      status: () => sink,
      json: (value: Json) => {
        result = value;
        return sink;
      },
      on: () => sink,
    };
    await this.chat(caller, { ...body, stream: false }, sink as unknown as Response);
    return result;
  }

  /** `POST /gateway/v1/embeddings` — tugas embedding, 768 dimensi (sama dengan indeks pgvector Akasha). */
  async embeddings(caller: Caller, body: Json) {
    // `model` = model tertentu tanpa cadangan (aplikasi meminta model yang sama untuk semua batch satu indeks, karena
    // vektor dari model berbeda tidak sebanding); tanpa itu model tugas `embedding` + cadangannya.
    const { list } = await this.candidates(
      caller.account.id,
      typeof body.model === "string" && body.model.trim() ? { model: body.model } : { task: "embedding" },
    );
    if (!list[0].embedding) throw new GatewayError(422, `Model "${list[0].label}" bukan model embedding.`);
    const input = body.input;
    if (!(typeof input === "string" || (Array.isArray(input) && input.every((x) => typeof x === "string"))))
      throw new GatewayError(422, "input wajib teks atau daftar teks.");
    let fallbackFrom: string | undefined;
    let last: UpstreamFailure | undefined;
    for (const model of list) {
      const started = Date.now();
      try {
        const { baseUrl, format, apiKey } = this.sources.endpointOf(model.source);
        if (format === ApiFormat.anthropic)
          throw new UpstreamFailure(422, "Sumber berformat Anthropic tidak punya embedding.", true);
        const upstream = await this.fetchJson(
          `${baseUrl}/embeddings`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: model.modelId, input, dimensions: EMBEDDING_DIMENSIONS }),
          },
          EMBED_TIMEOUT_MS,
        );
        if (!upstream.ok) throw await this.failure(upstream);
        const json = (await upstream.json()) as Json;
        const data = Array.isArray(json.data) ? (json.data as Json[]) : [];
        if (
          !data.every((d) => Array.isArray(d.embedding) && (d.embedding as unknown[]).length === EMBEDDING_DIMENSIONS)
        )
          throw new UpstreamFailure(422, `Model embedding tidak menghasilkan ${EMBEDDING_DIMENSIONS} dimensi.`, true);
        const usage = usageFromOpenAi(json.usage);
        await this.log(caller, "embedding", model, { ok: true, usage, durationMs: Date.now() - started, fallbackFrom });
        return { ...json, model: model.modelId };
      } catch (error) {
        if (!(error instanceof UpstreamFailure)) throw error;
        last = error;
        await this.log(caller, "embedding", model, {
          ok: false,
          error: error.message,
          durationMs: Date.now() - started,
          fallbackFrom,
        });
        if (!error.fallback) break;
        fallbackFrom ??= model.label;
      }
    }
    throw new GatewayError(
      callerStatus(last?.status ?? 500),
      last?.message ?? "Model embedding tidak menjawab.",
      last?.status,
    );
  }

  /** Tugas mana yang sudah punya model (aplikasi menampilkan "atur di Akai"). */
  async status(caller: Caller) {
    const routes = await this.prisma.aiTaskRoute.findMany({ where: { accountId: caller.account.id } });
    const enabled = new Map(
      (
        await this.prisma.aiModel.findMany({
          where: { accountId: caller.account.id, enabled: true },
          select: { id: true, modelId: true },
        })
      ).map((m) => [m.id, m.modelId]),
    );
    const byTask = new Map(routes.map((r) => [r.task, (r.modelIds as string[]).filter((id) => enabled.has(id))]));
    // `primary` = ID model utama tugas (urutan pertama yang menyala). Dipakai aplikasi untuk menandai vektor embedding
    // per model: vektor dari model berbeda tidak sebanding.
    return {
      tasks: AI_TASKS.map((task) => {
        const ids = byTask.get(task) ?? [];
        return { task, label: TASK_LABELS[task], models: ids.length, primary: ids[0] ? enabled.get(ids[0])! : null };
      }),
    };
  }
}
