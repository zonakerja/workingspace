import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import { memoryStorage } from "multer";
import { CallerService } from "../common/caller";
import { ChatService } from "./chat.service";

class CreateConversationDto {
  @IsOptional()
  @IsString()
  modelId?: string | null;

  @IsOptional()
  @IsString()
  projectId?: string | null;
}

class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  /** null = kembali ke tugas Chat (Otomatis) */
  @IsOptional()
  @IsString()
  modelId?: string | null;

  /** null = keluarkan dari proyek */
  @IsOptional()
  @IsString()
  projectId?: string | null;
}

class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}

/** Chat Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/chat")
export class ChatController {
  constructor(
    private readonly caller: CallerService,
    private readonly chat: ChatService,
  ) {}

  @Get("conversations")
  async list(@Req() req: Request, @Query("q") q?: string) {
    return this.chat.list(await this.caller.resolve(req), q);
  }

  @Post("conversations")
  async create(@Body() dto: CreateConversationDto, @Req() req: Request) {
    return this.chat.create(await this.caller.resolve(req), dto);
  }

  @Get("conversations/:id")
  async get(@Param("id") id: string, @Req() req: Request) {
    return this.chat.get(await this.caller.resolve(req), id);
  }

  @Patch("conversations/:id")
  async update(@Param("id") id: string, @Body() dto: UpdateConversationDto, @Req() req: Request) {
    return this.chat.update(await this.caller.resolve(req), id, dto);
  }

  @Delete("conversations/:id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.chat.remove(await this.caller.resolve(req), id);
  }

  /** Kirim pesan → jawaban stream (text/event-stream, format OpenAI Chat Completions). */
  @Post("conversations/:id/messages")
  async send(@Param("id") id: string, @Body() dto: SendMessageDto, @Req() req: Request, @Res() res: Response) {
    const caller = await this.caller.resolve(req);
    try {
      await this.chat.send(caller, id, dto, res);
    } catch (error) {
      // Galat sebelum stream mulai → jawaban JSON (res tidak lewat filter Nest karena @Res)
      if (res.headersSent) return void res.end();
      const status = (error as { getStatus?: () => number }).getStatus?.() ?? 500;
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      res
        .status(status)
        .json(
          typeof response === "object" && response ? response : { statusCode: status, message: "Akai gagal menjawab." },
        );
    }
  }

  @Post("attachments")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.chat.upload(await this.caller.resolve(req), file);
  }

  @Get("attachments/:id")
  async attachment(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    const row = await this.chat.attachment(await this.caller.resolve(req), id);
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `${row.kind === "image" || row.kind === "pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    res.end(Buffer.from(row.data));
  }
}
