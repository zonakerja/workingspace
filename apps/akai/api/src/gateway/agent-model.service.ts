import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { type AiModel, type AiSource, SourceKind } from "../generated/prisma/client";
import {
  basicClaudeRequest,
  chatCompletion,
  chunkFactory,
  ClaudeTurnMemory,
  claudeRequest,
  openAiUsage,
  replayableBlocks,
  runClaude,
} from "./agent-claude";
import { responsesChunks, responsesCompletion, responsesRequest } from "./agent-openai";
import { anthropicBaseUrl, isUnsupportedFeatureError } from "./claude-models";
import { type TokenUsage, isFallbackStatus, upstreamMessage, UpstreamFailure, usageFromOpenAi } from "./gateway-logic";

type Json = Record<string, unknown>;
type Candidate = AiModel & { source: AiSource };
type Endpoint = { baseUrl: string; apiKey: string };
export type AgentResult = { usage: TokenUsage; streamed: boolean; json?: Json };

/** Batas waktu satu panggilan model agen (jawaban panjang + pemikiran). */
const AGENT_TIMEOUT_MS = 10 * 60_000;

/**
 * Jalur agen gateway (`task: "agent"`, docs/AKAI.md §7 langkah 2): dipindah dari proxy agen Akasha agar biaya agen lewat Akai
 * tidak naik. Sumber berformat Anthropic memakai Messages API native lewat SDK (prompt caching per blok, blok pemikiran antar
 * giliran disimpan `ClaudeTurnMemory`, `fallbacks` sisi server, stream sungguhan); sumber OpenAI resmi memakai Responses API
 * (model bernalar hanya menerima alat di sana, `store: false`). Keluaran tetap format OpenAI Chat Completions.
 *
 * Galat sebelum jawaban dimulai → `UpstreamFailure` (gateway mencoba cadangan bila boleh); setelah stream dimulai → potongan
 * galat dikirim, stream ditutup, lalu `UpstreamFailure` tanpa cadangan (gateway tidak menulis jawaban lagi).
 */
@Injectable()
export class AgentModelService {
  private readonly logger = new Logger(AgentModelService.name);
  /** Blok pemikiran per akun di memori satu proses (hilang saat restart = API menurunkan pemikiran giliran itu, tidak galat). */
  private readonly claudeTurns = new ClaudeTurnMemory();

  private sse(res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
  }

  private send(res: Response, data: unknown) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** Galat setelah header terkirim: kirim potongan galat & tutup; sebelum itu: lempar agar cadangan bisa dicoba. */
  private fail(res: Response, status: number, message: string, aborted: boolean): never {
    if (res.headersSent && !res.writableEnded && !res.destroyed) {
      this.send(res, { error: { message, code: status } });
      res.end();
    }
    // Koneksi diputus pemanggil = jangan coba cadangan
    throw new UpstreamFailure(status, message, !res.headersSent && !aborted && isFallbackStatus(status));
  }

  async claude(
    accountId: string,
    model: Candidate,
    endpoint: Endpoint,
    body: Json,
    res: Response,
  ): Promise<AgentResult> {
    const request = claudeRequest(body, model.modelId, (toolIds) => this.claudeTurns.recall(accountId, toolIds));
    if (!request) throw new UpstreamFailure(400, "Permintaan chat tidak valid (messages kosong).", false);
    const streaming = body.stream === true;
    const viaRouter = model.source.kind === SourceKind.router;
    const client = new Anthropic({
      apiKey: endpoint.apiKey,
      baseURL: anthropicBaseUrl(endpoint.baseUrl),
      timeout: AGENT_TIMEOUT_MS,
      maxRetries: 1,
    });
    const controller = new AbortController();
    let closed = false;
    res.on("close", () => {
      closed = true;
      controller.abort();
    });
    const created = Math.floor(Date.now() / 1000);
    const chunks = chunkFactory(`chatcmpl-${randomUUID()}`, model.modelId, created);
    const attempt = (req: typeof request) =>
      runClaude(
        client,
        req,
        controller.signal,
        () => {
          if (!streaming || res.headersSent) return;
          this.sse(res);
          this.send(res, chunks.start());
        },
        (text) => {
          if (streaming) this.send(res, chunks.text(text));
        },
      );
    try {
      let message: Awaited<ReturnType<typeof attempt>>;
      try {
        message = await attempt(request);
      } catch (error) {
        // Router menolak fitur beta Anthropic sebelum menjawab → ulangi sekali dengan permintaan dasar
        if (!viaRouter || res.headersSent || !isUnsupportedFeatureError(error)) throw error;
        this.logger.warn(`Router menolak fitur beta Claude, diulang tanpa fitur itu: ${(error as Error).message}`);
        message = await attempt(basicClaudeRequest(request));
      }
      this.claudeTurns.remember(accountId, replayableBlocks(message.content));
      const usage = usageFromOpenAi(openAiUsage(message.usage));
      if (!streaming) return { usage, streamed: false, json: chatCompletion(message, created) };
      if (!res.headersSent) this.sse(res);
      chunks.finish(message).forEach((chunk) => this.send(res, chunk));
      res.write("data: [DONE]\n\n");
      res.end();
      return { usage, streamed: true };
    } catch (error) {
      if (error instanceof UpstreamFailure) throw error;
      const status = error instanceof Anthropic.APIError && error.status ? error.status : closed ? 499 : 503;
      const raw = error instanceof Error ? error.message : String(error);
      // Saldo kredit habis dikembalikan Anthropic sebagai 400 → 402 agar dialihkan ke cadangan
      const finalStatus = /credit balance/i.test(raw) ? 402 : status;
      const body = error instanceof Anthropic.APIError ? error.error : { message: raw };
      this.fail(res, finalStatus, upstreamMessage(finalStatus, body), closed);
    }
  }

  async openaiResponses(model: Candidate, endpoint: Endpoint, body: Json, res: Response): Promise<AgentResult> {
    const params = responsesRequest(body, model.modelId);
    if (!params) throw new UpstreamFailure(400, "Permintaan chat tidak valid (messages kosong).", false);
    const streaming = body.stream === true;
    const client = new OpenAI({
      apiKey: endpoint.apiKey,
      baseURL: endpoint.baseUrl,
      timeout: AGENT_TIMEOUT_MS,
      maxRetries: 1,
    });
    const controller = new AbortController();
    let closed = false;
    res.on("close", () => {
      closed = true;
      controller.abort();
    });
    const created = Math.floor(Date.now() / 1000);
    const chunks = responsesChunks(`chatcmpl-${randomUUID()}`, model.modelId, created);
    const usageOf = (response: { usage?: OpenAI.Responses.ResponseUsage | null }): TokenUsage => ({
      input: response.usage?.input_tokens ?? null,
      output: response.usage?.output_tokens ?? null,
      cached: response.usage?.input_tokens_details?.cached_tokens ?? null,
    });
    const open = () => {
      if (res.headersSent) return;
      this.sse(res);
      this.send(res, chunks.start());
    };
    try {
      if (!streaming) {
        const response = await client.responses.create({ ...params, stream: false }, { signal: controller.signal });
        return { usage: usageOf(response), streamed: false, json: responsesCompletion(response, created) as Json };
      }
      let usage: TokenUsage = { input: null, output: null, cached: null };
      const stream = await client.responses.create({ ...params, stream: true }, { signal: controller.signal });
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          open();
          this.send(res, chunks.text(event.delta));
        } else if (event.type === "response.failed" || event.type === "error") {
          const message = event.type === "error" ? event.message : event.response.error?.message;
          throw new UpstreamFailure(503, `Sumber model gagal menjawab: ${message ?? "tanpa keterangan"}`, true);
        } else if (event.type === "response.completed" || event.type === "response.incomplete") {
          open();
          usage = usageOf(event.response);
          chunks.finish(event.response).forEach((chunk) => this.send(res, chunk));
        }
      }
      open();
      res.write("data: [DONE]\n\n");
      res.end();
      return { usage, streamed: true };
    } catch (error) {
      if (error instanceof UpstreamFailure) this.fail(res, error.status, error.message, closed);
      const status = error instanceof OpenAI.APIError && error.status ? error.status : closed ? 499 : 503;
      const body = error instanceof OpenAI.APIError ? error.error : { message: String(error) };
      this.fail(res, status, upstreamMessage(status, body), closed);
    }
  }
}
