import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { OAUTH_PROVIDERS, type OAuthProvider } from "./oauth-logic";
import { OAuthService } from "./oauth.service";

class StartDto {
  @IsIn(OAUTH_PROVIDERS) provider: string;
  /** Minta juga izin Drive (pilih berkas & arsip dingin) */
  @IsOptional() @IsBoolean() drive?: boolean;
  /** ID akun yang sudah tersambung (izin tambahan untuk akun yang sama) */
  @IsOptional() @IsString() @MaxLength(64) accountId?: string;
}

class CalendarToggleDto {
  @IsBoolean() enabled: boolean;
}

/** Akun tersambung lewat OAuth (Google & Microsoft) + kalender dua arah + email Outlook (docs/AKUN-TERSAMBUNG.md tahap 2). */
@ApiTags("connections")
@Controller("connections")
export class ConnectionsController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly calendar: CalendarSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const accounts = await this.oauth.list(user.id);
    const calendars = await this.prisma.calendarConnection.findMany({ where: { userId: user.id } });
    const mail = await this.prisma.mailAccount.findMany({
      where: { userId: user.id, oauthAccountId: { not: null } },
      select: { id: true, oauthAccountId: true },
    });
    return {
      configured: this.oauth.configured(),
      redirectUri: this.oauth.redirectUri,
      accounts: accounts.map((a) => ({
        ...this.oauth.view(a),
        calendar: this.calendar.view(calendars.find((c) => c.oauthAccountId === a.id) ?? null),
        mailAccountId: mail.find((m) => m.oauthAccountId === a.id)?.id ?? null,
      })),
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post("oauth/start")
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    const existing = dto.accountId ? await this.oauth.own(user.id, dto.accountId) : undefined;
    return this.oauth.start(user.id, dto.provider as OAuthProvider, { drive: dto.drive, loginHint: existing?.email });
  }

  /** Publik: penyedia mengarahkan browser ke sini (user dikenali dari `state` sekali pakai). */
  @Get("oauth/callback")
  async callback(@Query() raw: Record<string, unknown>, @Res() res: Response) {
    // Objek biasa (bukan DTO): parameter tambahan penyedia tidak ditolak ValidationPipe
    const pick = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).slice(0, 4096) : undefined);
    res.redirect(
      302,
      await this.oauth.callback({
        code: pick("code"),
        state: pick("state"),
        error: pick("error"),
        error_description: pick("error_description"),
      }),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.oauth.remove(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(":id/calendar")
  connectCalendar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.calendar.connect(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(":id/calendar")
  toggleCalendar(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CalendarToggleDto) {
    return this.calendar.setEnabled(user.id, id, dto.enabled);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(":id/calendar/sync")
  syncCalendar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.calendar.syncNow(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(":id/calendar")
  disconnectCalendar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.calendar.disconnect(user.id, id);
  }
}
