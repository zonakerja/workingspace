import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { memoryStorage } from "multer";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { ConvertFileDto, ReconvertDto, UpdateConverterPrefsDto } from "./converter.dto";
import { ConverterService } from "./converter.service";

/** Batas multer = batas tertinggi env (`CONVERTER_MAX_MB` ≤ 200); batas sebenarnya diperiksa service. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Tools → Markdown Converter (docs/ARCHITECTURE.md §3.14). */
@ApiTags("converter")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("converter")
export class ConverterController {
  constructor(private readonly converter: ConverterService) {}

  @Get("status")
  status() {
    return this.converter.status();
  }

  @Get("preferences")
  getPrefs(@CurrentUser() user: AuthUser) {
    return this.converter.getPrefs(user.id);
  }

  @Put("preferences")
  setPrefs(@CurrentUser() user: AuthUser, @Body() dto: UpdateConverterPrefsDto) {
    return this.converter.setPrefs(user.id, dto);
  }

  @Get("stats")
  stats(@CurrentUser() user: AuthUser) {
    return this.converter.stats(user.id);
  }

  @Post("convert")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  convert(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ConvertFileDto,
  ) {
    if (!file) throw new BadRequestException("Pilih berkas untuk dikonversi.");
    return this.converter.convert(user.id, file, dto);
  }

  @Post("reconvert")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reconvert(@CurrentUser() user: AuthUser, @Body() dto: ReconvertDto) {
    return this.converter.reconvert(user.id, dto.scope);
  }
}
