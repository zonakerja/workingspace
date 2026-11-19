import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { Caller } from "../common/caller";
import { SourceKind } from "../generated/prisma/client";
import { GatewayService } from "../gateway/gateway.service";
import { SourcesService } from "../sources/sources.service";
import { toTranscribeError, transcribeWithGemini, type TranscribeOutput } from "./gemini-transcribe";
import type { SegmentResult } from "./transcript-logic";

export interface TranscribeResult extends TranscribeOutput {
  provider: string;
  model: string;
}

export type TranscribeJob =
  | { status: "running"; startedAt: number }
  | { status: "done"; startedAt: number; finishedAt: number; result: TranscribeResult }
  | { status: "failed"; startedAt: number; finishedAt: number; httpStatus: number; message: string };

const TEMP_DIR = join(tmpdir(), "akai-transcribe");
/** Hasil disimpan sementara agar aplikasi bisa mengambilnya kembali tanpa membayar transkrip kedua. */
const RESULT_TTL_MS = 24 * 60 * 60_000;
/** Batas audio yang diterima (rekaman rapat panjang bisa ratusan MB). */
export const TRANSCRIBE_MAX_BYTES = 500 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Kegagalan yang layak dicoba dengan model cadangan tugas Transkrip (key lain / kuota / sibuk). */
const FALLBACK_KINDS = new Set(["auth", "quota", "unavailable", "model"]);

/**
 * Transkrip audio untuk aplikasi ekosistem (docs/AKAI.md §4): aplikasi mengirim isi audio (aliran) + kunci pekerjaan, Akai
 * mengerjakannya di latar belakang memakai model tugas `transcribe` (Gemini langsung) dan aplikasi menanyakan statusnya.
 * Status & hasil per potongan di memori satu proses (restart = pekerjaan hilang, aplikasi bisa memulai lagi); potongan
 * yang sudah berhasil tidak dibayar lagi saat diulang.
 */
@Injectable()
export class TranscribeService implements OnModuleInit {
  private readonly logger = new Logger(TranscribeService.name);
  private readonly jobs = new Map<string, TranscribeJob>();
  private readonly segments = new Map<string, Map<number, SegmentResult>>();

  constructor(
    private readonly gateway: GatewayService,
    private readonly sources: SourcesService,
  ) {}

  /** Salinan sementara dari proses sebelumnya tidak dipakai siapa pun lagi. */
  async onModuleInit() {
    await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => undefined);
  }

  private jobKey(caller: Caller, key: string) {
    return `${caller.account.id}:${caller.clientId}:${key}`;
  }

  /**
   * Mulai transkrip dari aliran audio. Bila pekerjaan dengan kunci sama sedang berjalan atau sudah selesai lengkap, yang ada
   * dikembalikan dan aliran dibuang.
   */
  async start(caller: Caller, key: string, mimeType: string, body: Readable, declaredSize: number | null) {
    this.prune();
    if (!KEY_PATTERN.test(key)) throw new BadRequestException("Kunci pekerjaan tidak valid.");
    const mime = mimeType.split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("audio/")) throw new BadRequestException("Berkas ini bukan audio.");
    if (declaredSize !== null && declaredSize > TRANSCRIBE_MAX_BYTES)
      throw new PayloadTooLargeException("Audio terlalu besar untuk ditranskrip (maks. 500 MB).");

    const id = this.jobKey(caller, key);
    const existing = this.jobs.get(id);
    if (existing?.status === "running" || (existing?.status === "done" && !existing.result.truncated)) {
      body.resume();
      return existing;
    }
    // Model dipastikan ada sebelum menerima isi audio (galat "atur di Akai" langsung terlihat)
    const { list } = await this.gateway.candidates(caller.account.id, { task: "transcribe" });

    // Disalin ke disk (bukan memori): rekaman panjang bisa ratusan MB
    await mkdir(TEMP_DIR, { recursive: true });
    const filePath = join(TEMP_DIR, randomUUID());
    let received = 0;
    body.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > TRANSCRIBE_MAX_BYTES)
        body.destroy(new PayloadTooLargeException("Audio terlalu besar (maks. 500 MB)."));
    });
    try {
      await pipeline(body, createWriteStream(filePath));
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException("Isi audio tidak diterima utuh.");
    }
    const size = (await stat(filePath)).size;
    if (size === 0) {
      await rm(filePath, { force: true }).catch(() => undefined);
      throw new BadRequestException("Isi audio kosong.");
    }

    const job: TranscribeJob = { status: "running", startedAt: Date.now() };
    this.jobs.set(id, job);
    void this.run(caller, id, list, filePath, mime, size, job.startedAt);
    return job;
  }

  status(caller: Caller, key: string): TranscribeJob | null {
    this.prune();
    return this.jobs.get(this.jobKey(caller, key)) ?? null;
  }

  private prune() {
    const now = Date.now();
    for (const [key, job] of this.jobs) {
      if (job.status !== "running" && now - job.finishedAt > RESULT_TTL_MS) {
        this.jobs.delete(key);
        this.segments.delete(key);
      }
    }
  }

  private async run(
    caller: Caller,
    id: string,
    list: Awaited<ReturnType<GatewayService["candidates"]>>["list"],
    filePath: string,
    mimeType: string,
    sizeBytes: number,
    startedAt: number,
  ) {
    let segments = this.segments.get(id);
    if (!segments) {
      segments = new Map();
      this.segments.set(id, segments);
    }
    let fallbackFrom: string | undefined;
    let lastMessage = "Transkrip gagal.";
    let lastStatus = 422;
    try {
      for (const model of list) {
        const started = Date.now();
        try {
          if (model.source.kind !== SourceKind.gemini)
            throw new HttpException("Transkrip audio hanya bisa memakai sumber Google Gemini langsung.", 422);
          const { apiKey } = this.sources.endpointOf(model.source);
          const output = await transcribeWithGemini({
            apiKey,
            model: model.modelId,
            filePath,
            mimeType,
            sizeBytes,
            segments,
          });
          await this.gateway.log(caller, "transcribe", model, {
            ok: true,
            durationMs: Date.now() - started,
            fallbackFrom,
          });
          this.jobs.set(id, {
            status: "done",
            startedAt,
            finishedAt: Date.now(),
            result: { ...output, provider: "gemini", model: model.modelId },
          });
          this.logger.log(`Transkrip ${id} selesai: ${output.text.length} karakter, ${output.passes} bagian`);
          return;
        } catch (error) {
          const failure = error instanceof HttpException ? null : toTranscribeError(error);
          lastMessage = failure
            ? `Google Gemini (${model.label}): ${failure.message.slice(0, 300)}`
            : (error as Error).message;
          lastStatus = failure?.kind === "quota" ? 429 : 422;
          await this.gateway.log(caller, "transcribe", model, {
            ok: false,
            error: lastMessage,
            durationMs: Date.now() - started,
            fallbackFrom,
          });
          if (failure && !FALLBACK_KINDS.has(failure.kind)) break;
          fallbackFrom ??= model.label;
        }
      }
      this.jobs.set(id, {
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        httpStatus: lastStatus,
        message: lastMessage,
      });
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  }
}
