import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { ConvertFileDto, ReconvertDto, RenameConvertedDocumentDto, UpdateConverterPrefsDto } from "./converter.dto";
import { ConverterLibraryService } from "./converter-library.service";
import { ConverterService } from "./converter.service";

/** Batas multer = batas tertinggi env (`CONVERTER_MAX_MB` ≤ 200); batas sebenarnya diperiksa service. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Tools → Markdown Converter (docs/ARCHITECTURE.md §3.14). */
@ApiTags("converter")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("converter")
export class ConverterController {
  constructor(
    private readonly converter: ConverterService,
    private readonly library: ConverterLibraryService,
  ) {}

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

  @Post("reconvert")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reconvert(@CurrentUser() user: AuthUser, @Body() dto: ReconvertDto) {
    return this.converter.reconvert(user.id, dto.scope);
  }

  // Pustaka: hasil konversi yang disimpan (berkas asal tidak disimpan)
  @Get("documents")
  listDocuments(@CurrentUser() user: AuthUser) {
    return this.library.list(user.id);
  }

  @Get("documents/:id")
  getDocument(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.library.get(user.id, id);
  }

  @Post("documents")
  @HttpCode(202)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  createDocument(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ConvertFileDto,
  ) {
    if (!file) throw new BadRequestException("Pilih berkas untuk dikonversi.");
    return this.library.create(user.id, file, dto);
  }

  @Patch("documents/:id")
  renameDocument(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RenameConvertedDocumentDto) {
    return this.library.rename(user.id, id, dto.title);
  }

  @Delete("documents/:id")
  removeDocument(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.library.remove(user.id, id);
  }
}
