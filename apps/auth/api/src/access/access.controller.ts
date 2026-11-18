import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type { Request } from "express";
import { SessionsService } from "../accounts/sessions.service";
import { clientInfo } from "../common/http";
import { DURATION_OPTIONS, PURPOSE_MAX } from "./access-logic";
import { AccessService } from "./access.service";

export class AccessRequestItemDto {
  @IsString()
  @MaxLength(60)
  appKey: string;

  @IsString()
  @MaxLength(PURPOSE_MAX + 200)
  purpose: string;
}

class CreateRequestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AccessRequestItemDto)
  requests: AccessRequestItemDto[];
}

class ListQuery {
  @IsOptional()
  @IsIn(["pending", "all"])
  status?: "pending" | "all";
}

class ApproveDto {
  @IsIn(["admin", "member"])
  role: "admin" | "member";

  /** Lama akses (hari); null = tanpa batas */
  @IsOptional()
  @IsInt()
  @IsIn([...DURATION_OPTIONS, null])
  days: number | null;
}

class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Pengajuan akses aplikasi: katalog publik, pengajuan pemilik akun, dan keputusan super admin. */
@Controller()
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly sessions: SessionsService,
  ) {}

  private async session(req: Request) {
    const session = await this.sessions.current(req);
    if (!session) throw new UnauthorizedException("Belum masuk.");
    return session;
  }

  private async admin(req: Request) {
    const session = await this.session(req);
    if (!session.account.superAdmin) throw new ForbiddenException("Khusus super admin.");
    return session.account;
  }

  /** Aplikasi yang bisa diajukan saat mendaftar (publik). */
  @Get("api/access/apps")
  catalog() {
    return this.access.catalog();
  }

  @Get("api/access")
  async overview(@Req() req: Request) {
    const session = await this.session(req);
    return this.access.overview(session.accountId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("api/access/requests")
  async create(@Body() dto: CreateRequestsDto, @Req() req: Request) {
    const session = await this.session(req);
    await this.access.create(session.accountId, dto.requests, clientInfo(req));
    return this.access.overview(session.accountId);
  }

  @Get("api/admin/access-requests")
  async list(@Query() query: ListQuery, @Req() req: Request) {
    await this.admin(req);
    return this.access.adminList(query.status ?? "pending");
  }

  @Post("api/admin/access-requests/:id/approve")
  async approve(@Param("id") id: string, @Body() dto: ApproveDto, @Req() req: Request) {
    const admin = await this.admin(req);
    return this.access.approve(id, admin.id, { role: dto.role, days: dto.days ?? null }, clientInfo(req));
  }

  @Post("api/admin/access-requests/:id/reject")
  @HttpCode(204)
  async reject(@Param("id") id: string, @Body() dto: RejectDto, @Req() req: Request) {
    const admin = await this.admin(req);
    await this.access.reject(id, admin.id, dto.note ?? null, clientInfo(req));
  }
}
