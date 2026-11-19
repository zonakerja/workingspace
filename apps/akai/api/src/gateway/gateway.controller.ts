import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CallerService } from "../common/caller";
import { TranscribeService } from "../transcribe/transcribe.service";
import { GatewayService } from "./gateway.service";

type Json = Record<string, unknown>;

/**
 * Gateway model untuk aplikasi ekosistem (server ke server, HTTP Basic klien + `X-Akai-Subject`). Body bebas (format OpenAI)
 * sehingga tidak divalidasi DTO; batas ukuran body di main.ts. docs/AKAI.md §4.
 */
@SkipThrottle()
@Controller("gateway/v1")
export class GatewayController {
  constructor(
    private readonly gateway: GatewayService,
    private readonly caller: CallerService,
    private readonly transcriber: TranscribeService,
  ) {}

  @Post("chat/completions")
  async chat(@Body() body: Json, @Req() req: Request, @Res() res: Response) {
    await this.gateway.chat(await this.caller.resolve(req), body ?? {}, res);
  }

  @Post("embeddings")
  @HttpCode(200)
  async embeddings(@Body() body: Json, @Req() req: Request) {
    return this.gateway.embeddings(await this.caller.resolve(req), body ?? {});
  }

  /**
   * Transkrip audio asinkron: body = isi audio mentah (`Content-Type: audio/*`, tanpa parser JSON), header `X-Akai-Key` =
   * kunci pekerjaan pilihan aplikasi (mis. ID berkas). Status diambil lewat GET.
   */
  @Post("audio/transcriptions")
  @HttpCode(202)
  async transcribe(@Req() req: Request) {
    const caller = await this.caller.resolve(req);
    const length = Number(req.headers["content-length"]);
    return this.transcriber.start(
      caller,
      String(req.headers["x-akai-key"] ?? ""),
      String(req.headers["content-type"] ?? ""),
      req,
      Number.isFinite(length) && length > 0 ? length : null,
    );
  }

  @Get("audio/transcriptions/:key")
  async transcription(@Param("key") key: string, @Req() req: Request) {
    const job = this.transcriber.status(await this.caller.resolve(req), key);
    if (!job) throw new NotFoundException("Tidak ada transkrip untuk kunci ini.");
    return job;
  }

  @Get("status")
  async status(@Req() req: Request) {
    return this.gateway.status(await this.caller.resolve(req));
  }
}
