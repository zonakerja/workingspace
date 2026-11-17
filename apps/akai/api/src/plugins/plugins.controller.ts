import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { PLUGIN_LIMITS } from "./plugin-logic";
import { PluginsService } from "./plugins.service";

class PluginDto {
  @IsOptional()
  @IsString()
  @MaxLength(PLUGIN_LIMITS.codeChars)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  catalogKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowWrite?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, string>;
}

class TestDto {
  @IsString()
  @MaxLength(40)
  tool: string;

  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

/** Plugin JavaScript Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/plugins")
export class PluginsController {
  constructor(
    private readonly caller: CallerService,
    private readonly plugins: PluginsService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.plugins.list(await this.caller.resolve(req));
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() req: Request) {
    return this.plugins.get(await this.caller.resolve(req), id);
  }

  @Post()
  async install(@Body() dto: PluginDto, @Req() req: Request) {
    return this.plugins.install(await this.caller.resolve(req), dto);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: PluginDto, @Req() req: Request) {
    return this.plugins.update(await this.caller.resolve(req), id, dto);
  }

  @Post(":id/test")
  @HttpCode(200)
  async test(@Param("id") id: string, @Body() dto: TestDto, @Req() req: Request) {
    return this.plugins.test(await this.caller.resolve(req), id, dto.tool, dto.input ?? {});
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.plugins.remove(await this.caller.resolve(req), id);
  }
}
