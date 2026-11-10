import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { AGENT_ACTION_STATUSES } from "./agent-action-logic";
import { AgentActionsService } from "./agent-actions.service";

class ListActionsQuery {
  @ApiPropertyOptional({ enum: AGENT_ACTION_STATUSES })
  @IsOptional()
  @IsIn(AGENT_ACTION_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  take?: number;
}

class UndoDto {
  @ApiPropertyOptional({ description: "true = tetap batalkan walau data sudah diubah lagi" })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

class RejectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Riwayat aksi agen milik user: batalkan buat/ubah, setujui/tolak permintaan hapus. */
@ApiTags("agent-actions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("agent/actions")
export class AgentActionsController {
  constructor(private readonly actions: AgentActionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListActionsQuery) {
    return this.actions.list(user, query);
  }

  @Get("pending-count")
  async pendingCount(@CurrentUser() user: AuthUser) {
    return { count: await this.actions.countPending(user) };
  }

  @Post(":id/undo")
  @HttpCode(200)
  undo(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UndoDto) {
    return this.actions.undo(user, id, dto.force);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.actions.approve(user, id);
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RejectDto) {
    return this.actions.reject(user, id, dto.note);
  }
}
