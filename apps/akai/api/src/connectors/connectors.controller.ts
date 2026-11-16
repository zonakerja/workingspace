import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { Request } from "express";
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
}

/** Konektor MCP Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/connectors")
export class ConnectorsController {
  constructor(
    private readonly caller: CallerService,
    private readonly connectors: ConnectorsService,
  ) {}

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
