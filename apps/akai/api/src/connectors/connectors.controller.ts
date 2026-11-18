import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import { CallerService } from "../common/caller";
import { ConnectorsService } from "./connectors.service";

class CreateConnectorDto {
  @IsIn(["akasha", "custom"])
  kind: "akasha" | "custom";

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  /** Kunci aplikasi katalog (connector-catalog.ts) */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  preset?: string;

  @IsOptional()
  @IsIn(["none", "token", "oauth"])
  authType?: "none" | "token" | "oauth";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  oauthClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  oauthClientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  oauthScope?: string;
}

class UpdateConnectorDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowWrite?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  /** "" = hapus token */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  @IsOptional()
  @IsIn(["none", "token", "oauth"])
  authType?: "none" | "token" | "oauth";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  oauthClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  oauthClientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  oauthScope?: string;
}

/** Konektor MCP Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/connectors")
export class ConnectorsController {
  constructor(
    private readonly caller: CallerService,
    private readonly connectors: ConnectorsService,
  ) {}

  /** Alamat tujuan halaman izin aplikasi luar (tanpa sesi: state sekali pakai) → kembali ke halaman Konektor Akai web. */
  @Get("oauth/callback")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async callback(
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    res.redirect(await this.connectors.oauthCallback(code, state, error));
  }

  @Get("catalog")
  async catalog(@Req() req: Request) {
    return this.connectors.catalog(await this.caller.resolve(req));
  }

  @Get()
  async list(@Req() req: Request) {
    return this.connectors.list(await this.caller.resolve(req));
  }

  @Post()
  async create(@Body() dto: CreateConnectorDto, @Req() req: Request) {
    return this.connectors.create(await this.caller.resolve(req), dto);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateConnectorDto, @Req() req: Request) {
    return this.connectors.update(await this.caller.resolve(req), id, dto);
  }

  /** Sambungkan: OAuth → { authorizationUrl } untuk dibuka browser; lainnya → { connector } setelah diuji. */
  @Post(":id/connect")
  @HttpCode(200)
  async connect(@Param("id") id: string, @Req() req: Request) {
    return this.connectors.connect(await this.caller.resolve(req), id);
  }

  @Post(":id/refresh")
  @HttpCode(200)
  async refresh(@Param("id") id: string, @Req() req: Request) {
    return this.connectors.refresh(await this.caller.resolve(req), id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.connectors.remove(await this.caller.resolve(req), id);
  }
}
