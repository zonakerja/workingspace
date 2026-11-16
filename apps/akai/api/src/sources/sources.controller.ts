import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { ApiFormat, SourceKind } from "../generated/prisma/client";
import { ROUTER_PRESETS, type RouterPreset } from "./source-logic";
import { SourcesService } from "./sources.service";
import { AI_TASKS, type AiTask } from "./task-logic";

class CreateSourceDto {
  @IsIn(Object.values(SourceKind))
  kind: SourceKind;

  @IsOptional()
  @IsIn(ROUTER_PRESETS)
  preset?: RouterPreset;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsIn(Object.values(ApiFormat))
  apiFormat?: ApiFormat;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  apiKey: string;
}

class UpdateSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsIn(Object.values(ApiFormat))
  apiFormat?: ApiFormat;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

class ModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  contextLength?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceIn?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceOut?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string | null;

  @IsOptional() @IsBoolean() packaged?: boolean;
  @IsOptional() @IsBoolean() vision?: boolean;
  @IsOptional() @IsBoolean() pdf?: boolean;
  @IsOptional() @IsBoolean() tools?: boolean;
  @IsOptional() @IsBoolean() embedding?: boolean;
  @IsOptional() @IsBoolean() audio?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class AddModelDto extends ModelDto {
  @IsString()
  sourceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  modelId: string;
}

class TaskDto {
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  modelIds: string[];
}

/**
 * Pengaturan model milik akun (docs/AKAI.md §4). Langkah 6a: dipanggil aplikasi ekosistem atas nama akun SSO
 * (`CallerService`); sesi web Akai menyusul.
 */
@Controller("api")
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly caller: CallerService,
  ) {}

  private async accountId(req: Request) {
    return (await this.caller.resolve(req)).account.id;
  }

  @Get("sources")
  async list(@Req() req: Request) {
    return this.sources.list(await this.accountId(req));
  }

  @Post("sources")
  async create(@Body() dto: CreateSourceDto, @Req() req: Request) {
    return this.sources.create(await this.accountId(req), dto);
  }

  @Patch("sources/:id")
  async update(@Param("id") id: string, @Body() dto: UpdateSourceDto, @Req() req: Request) {
    return this.sources.update(await this.accountId(req), id, dto);
  }

  @Delete("sources/:id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.sources.remove(await this.accountId(req), id);
  }

  @Post("sources/:id/test")
  @HttpCode(200)
  async test(@Param("id") id: string, @Req() req: Request) {
    return this.sources.test(await this.accountId(req), id);
  }

  @Post("sources/:id/catalog")
  @HttpCode(200)
  async refreshCatalog(@Param("id") id: string, @Req() req: Request) {
    return this.sources.refreshCatalog(await this.accountId(req), id);
  }

  @Get("sources/:id/catalog")
  async catalog(@Param("id") id: string, @Req() req: Request) {
    return this.sources.catalog(await this.accountId(req), id);
  }

  @Get("models")
  async models(@Req() req: Request) {
    return this.sources.listModels(await this.accountId(req));
  }

  @Post("models")
  async addModel(@Body() dto: AddModelDto, @Req() req: Request) {
    const { sourceId, modelId, ...input } = dto;
    return this.sources.addModel(await this.accountId(req), sourceId, modelId, input);
  }

  @Patch("models/:id")
  async updateModel(@Param("id") id: string, @Body() dto: ModelDto, @Req() req: Request) {
    return this.sources.updateModel(await this.accountId(req), id, dto);
  }

  @Delete("models/:id")
  @HttpCode(204)
  async removeModel(@Param("id") id: string, @Req() req: Request) {
    await this.sources.removeModel(await this.accountId(req), id);
  }

  @Get("tasks")
  async tasks(@Req() req: Request) {
    return this.sources.tasks(await this.accountId(req));
  }

  @Put("tasks/:task")
  async setTask(@Param("task") task: string, @Body() dto: TaskDto, @Req() req: Request) {
    if (!AI_TASKS.includes(task as AiTask)) throw new NotFoundException("Tugas tidak dikenal.");
    return this.sources.setTask(await this.accountId(req), task as AiTask, dto.modelIds);
  }
}
