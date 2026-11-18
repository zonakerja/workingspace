import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { ColdStorageService } from "./cold-storage.service";
import { COLD_MAX_DAYS, COLD_MIN_DAYS } from "./drive-logic";
import { DriveService } from "./drive.service";

/** ID berkas/folder Google Drive & OneDrive (OneDrive memuat "!") */
const DRIVE_ID = /^[A-Za-z0-9_.!-]{1,200}$/;

class ListQuery {
  @IsOptional() @Matches(DRIVE_ID) folder?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

class ColdSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(64) accountId?: string;
  @IsOptional() @IsNumber() @Min(COLD_MIN_DAYS) @Max(COLD_MAX_DAYS) afterDays?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1024) minSizeMb?: number;
}

/** Drive sebagai penyimpanan (docs/AKUN-TERSAMBUNG.md tahap 4): pilih berkas dari Google Drive / OneDrive + arsip dingin. */
@ApiTags("drive")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("drive")
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly cold: ColdStorageService,
  ) {}

  @Get("accounts")
  accounts(@CurrentUser() user: AuthUser) {
    return this.drive.accounts(user.id);
  }

  @Get("accounts/:id/picker")
  picker(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.drive.pickerConfig(user.id, id);
  }

  @Get("accounts/:id/items")
  list(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query() query: ListQuery) {
    return this.drive.list(user.id, id, query);
  }

  /** Isi berkas Drive (dialirkan; frontend mengunggahnya lewat jalur unggah form). */
  @Get("accounts/:id/files/:fileId/content")
  async content(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Res() res: Response,
  ) {
    if (!DRIVE_ID.test(fileId)) {
      res.status(400).json({ statusCode: 400, message: "ID berkas tidak valid." });
      return;
    }
    const file = await this.drive.open(user.id, id, fileId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader("X-File-Name", encodeURIComponent(file.name));
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "no-store");
    file.stream.on("error", () => res.destroy());
    file.stream.pipe(res);
  }

  @Get("cold")
  coldStatus(@CurrentUser() user: AuthUser) {
    return this.cold.status(user.id);
  }

  @Put("cold")
  coldUpdate(@CurrentUser() user: AuthUser, @Body() dto: ColdSettingsDto) {
    return this.cold.update(user.id, dto);
  }

  @HttpCode(200)
  @Post("cold/run")
  coldRun(@CurrentUser() user: AuthUser) {
    return this.cold.runNow(user.id);
  }

  @HttpCode(200)
  @Post("cold/restore")
  coldRestore(@CurrentUser() user: AuthUser) {
    return this.cold.restoreAll(user.id);
  }
}
