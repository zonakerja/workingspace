import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { SCHEDULE_LIMITS } from "./schedule-logic";
import { SchedulesService } from "./schedules.service";

class ScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(SCHEDULE_LIMITS.nameChars)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHEDULE_LIMITS.promptChars)
  prompt?: string;

  @IsOptional()
  @IsObject()
  schedule?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  timezone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  modelId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Tugas terjadwal Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/schedules")
export class SchedulesController {
  constructor(
    private readonly caller: CallerService,
    private readonly schedules: SchedulesService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.schedules.list(await this.caller.resolve(req));
  }

  @Post()
  async create(@Body() dto: ScheduleDto, @Req() req: Request) {
    return this.schedules.create(await this.caller.resolve(req), dto);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: ScheduleDto, @Req() req: Request) {
    return this.schedules.update(await this.caller.resolve(req), id, dto);
  }

  @Get(":id/runs")
  async runs(@Param("id") id: string, @Req() req: Request) {
    return this.schedules.runs(await this.caller.resolve(req), id);
  }

  @Post(":id/run")
  @HttpCode(202)
  async run(@Param("id") id: string, @Req() req: Request) {
    return this.schedules.runNow(await this.caller.resolve(req), id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.schedules.remove(await this.caller.resolve(req), id);
  }
}
