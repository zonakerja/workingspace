import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { memoryStorage } from "multer";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { AI_MAX_ATTACHMENT_BYTES, AI_MAX_ATTACHMENTS, AiService } from "./ai.service";
import { GenerateAiDto, SearchAiIndexDto, SmartSearchDto, UpdateAiSettingsDto } from "./dto/ai.dto";
import { AiIndexQueueService } from "./index/ai-index-queue.service";
import { LockService } from "../security/lock.service";
import { AiIndexService } from "./index/ai-index.service";

/**
 * Fitur AI Akasha. Semua panggilan model lewat gateway Akai (key & pembagian tugas diatur di Akai → Model); Akasha menyusun
 * prompt, potongan pengetahuan, dan penyaring (PIN, berbagi). docs/KAJIAN-AI-TERPUSAT.md.
 */
@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly index: AiIndexService,
    private readonly indexQueue: AiIndexQueueService,
    private readonly locks: LockService,
  ) {}

  @Get("settings")
  getSettings(@CurrentUser() user: AuthUser) {
    return this.ai.getSettings(user.id);
  }

  @Patch("settings")
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateAiSettingsDto) {
    return this.ai.updateSettings(user.id, dto);
  }

  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        files: { type: "array", items: { type: "string", format: "binary" } },
      },
    },
  })
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(
    FilesInterceptor("files", AI_MAX_ATTACHMENTS, {
      storage: memoryStorage(),
      // Prompt (field teks) bisa memuat konteks data user yang panjang
      limits: { fileSize: AI_MAX_ATTACHMENT_BYTES, fieldSize: 5 * 1024 * 1024 },
    }),
  )
  @HttpCode(200)
  @Post("generate")
  generate(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateAiDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.ai.generate(user.id, dto.prompt, files ?? []);
  }

  // ---------------------------------------------------------------- Indeks pengetahuan (RAG)

  @Get("index")
  indexStatus(@CurrentUser() user: AuthUser) {
    return this.index.status(user.id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(202)
  @Post("index/rebuild")
  async rebuildIndex(@CurrentUser() user: AuthUser) {
    await this.indexQueue.enqueueRebuild(user.id);
    return { queued: true };
  }

  /** Uji pencarian indeks (gabungan makna + kata persis) — dasar chatbot RAG. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("index/search")
  async searchIndex(@CurrentUser() user: AuthUser, @Query() query: SearchAiIndexDto) {
    return this.index.search(user.id, query.q, query.limit, { includeLocked: await this.locks.isUnlocked(user) });
  }

  /** Pencarian Pintar (Ctrl+K): item & berkas semua modul. Mode `text` tanpa AI, `meaning` = satu embedding. */
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get("search")
  async smartSearch(@CurrentUser() user: AuthUser, @Query() query: SmartSearchDto) {
    const unlocked = await this.locks.isUnlocked(user);
    return this.index.smartSearch(user.id, query.q.trim(), query.mode ?? "text", 40, unlocked);
  }
}
