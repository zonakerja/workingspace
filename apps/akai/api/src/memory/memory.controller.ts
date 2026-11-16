import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsString, MaxLength, MinLength } from "class-validator";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { MemoryService } from "./memory.service";

class MemoryContentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  content: string;
}

class MemorySettingsDto {
  @IsBoolean()
  enabled: boolean;
}

/** Memori Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/memory")
export class MemoryController {
  constructor(
    private readonly caller: CallerService,
    private readonly memory: MemoryService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.memory.list(await this.caller.resolve(req));
  }

  @Patch("settings")
  async settings(@Body() dto: MemorySettingsDto, @Req() req: Request) {
    return this.memory.setEnabled(await this.caller.resolve(req), dto.enabled);
  }

  @Post()
  async add(@Body() dto: MemoryContentDto, @Req() req: Request) {
    return this.memory.add(await this.caller.resolve(req), dto.content);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: MemoryContentDto, @Req() req: Request) {
    return this.memory.update(await this.caller.resolve(req), id, dto.content);
  }

  /** Hapus semua memori. */
  @Delete()
  @HttpCode(204)
  async clear(@Req() req: Request) {
    await this.memory.clear(await this.caller.resolve(req));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.memory.remove(await this.caller.resolve(req), id);
  }
}
