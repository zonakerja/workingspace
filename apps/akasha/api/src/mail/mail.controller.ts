import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { INBOX_DAYS } from "./inbox-logic";
import { MailInboxService } from "./mail-inbox.service";
import { MAIL_PROVIDERS } from "./mail-logic";
import { MailService } from "./mail.service";

export class MailAccountDto {
  @ApiPropertyOptional({ enum: MAIL_PROVIDERS })
  @IsOptional()
  @IsIn(MAIL_PROVIDERS)
  provider?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) address?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  displayName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(253)
  smtpHost?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  smtpPort?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  smtpSecure?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(254)
  smtpUser?: string | null;

  @ApiPropertyOptional({ description: "Kata sandi SMTP / Sandi Aplikasi; tidak pernah dikembalikan" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() digestEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) digestTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) digestTimezone?: string;
}

export class TestMailDto {
  @ApiPropertyOptional({ description: "Penerima uji; kosong = alamat akun sendiri" })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  to?: string;
}

export class InboxSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ description: "Masukkan email ke indeks AI" }) @IsOptional() @IsBoolean() index?: boolean;
  @ApiPropertyOptional({ enum: INBOX_DAYS }) @IsOptional() @IsIn(INBOX_DAYS) days?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(253)
  imapHost?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  imapPort?: number | null;
}

export class OutlookAccountDto {
  @IsString() @MaxLength(40) oauthAccountId: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
}

export class MessageQueryDto {
  @IsOptional() @IsString() @MaxLength(40) accountId?: string;
  @IsOptional() @IsIn(["new", "done", "ignored"]) status?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(40) before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

export class MessageStatusDto {
  @IsIn(["new", "done", "ignored"]) status: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class MessageTodoDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @Matches(YMD) @IsISO8601({ strict: true }) date: string;
  @IsIn(["low", "medium", "high"]) priority: string;
}

export class MessageAgendaDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @Matches(YMD) @IsISO8601({ strict: true }) startDate: string;
  @IsOptional() @ValidateIf((_, v) => v !== "") @Matches(HM) startTime?: string;
  @IsOptional() @ValidateIf((_, v) => v !== "") @Matches(HM) endTime?: string;
}

@ApiTags("mail")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("mail")
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly inbox: MailInboxService,
  ) {}

  @Get("presets")
  presets() {
    return this.mail.presets();
  }

  @Get("accounts")
  list(@CurrentUser() user: AuthUser) {
    return this.mail.list(user.id);
  }

  @Post("accounts")
  create(@CurrentUser() user: AuthUser, @Body() dto: MailAccountDto) {
    return this.mail.create(user.id, dto);
  }

  @Patch("accounts/:id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MailAccountDto) {
    return this.mail.update(user.id, id, dto);
  }

  @Delete("accounts/:id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.mail.get(user.id, id);
    await this.inbox.forgetAccount(user.id, id);
    return this.mail.remove(user.id, id);
  }

  @Post("accounts/outlook")
  createOutlook(@CurrentUser() user: AuthUser, @Body() dto: OutlookAccountDto) {
    return this.mail.createOutlook(user.id, dto.oauthAccountId, dto.label);
  }

  @Patch("accounts/:id/inbox")
  async inboxSettings(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: InboxSettingsDto) {
    await this.inbox.updateSettings(user.id, id, dto);
    return this.mail.get(user.id, id);
  }

  @HttpCode(200)
  @Post("accounts/:id/inbox/sync")
  async inboxSync(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const result = await this.inbox.syncNow(user.id, id);
    return { ...result, account: await this.mail.get(user.id, id) };
  }

  @Get("messages")
  messages(@CurrentUser() user: AuthUser, @Query() query: MessageQueryDto) {
    return this.inbox.list(user.id, query);
  }

  @Get("messages/:id")
  message(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.inbox.get(user.id, id);
  }

  @Patch("messages/:id")
  messageStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MessageStatusDto) {
    return this.inbox.setStatus(user.id, id, dto.status);
  }

  @HttpCode(200)
  @Post("messages/:id/todo")
  messageTodo(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MessageTodoDto) {
    return this.inbox.toTodo(user, id, dto);
  }

  @HttpCode(200)
  @Post("messages/:id/agenda")
  messageAgenda(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MessageAgendaDto) {
    return this.inbox.toAgenda(user, id, dto);
  }

  @HttpCode(200)
  @Post("accounts/:id/test")
  test(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: TestMailDto) {
    return this.mail.test(user.id, id, dto.to);
  }

  @HttpCode(200)
  @Post("accounts/:id/digest")
  digest(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.mail.sendDigestNow(user.id, id);
  }
}
