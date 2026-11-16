import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CallerService } from "../common/caller";
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

  @Get("status")
  async status(@Req() req: Request) {
    return this.gateway.status(await this.caller.resolve(req));
  }
}
