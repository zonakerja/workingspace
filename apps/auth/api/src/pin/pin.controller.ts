import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import type { Request } from "express";
import { SessionsService } from "../accounts/sessions.service";
import { clientInfo } from "../common/http";
import { ClientAuthService } from "../common/client-auth";
import { PinService } from "./pin.service";

class SetPinDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "PIN harus 6 angka." })
  pin: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

class RemovePinDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

class VerifyPinDto {
  @IsString()
  @MaxLength(60)
  sub: string;

  @IsString()
  @MaxLength(20)
  pin: string;
}

class StatusQuery {
  @IsString()
  @MaxLength(60)
  sub: string;
}

/**
 * PIN keamanan: `/api/pin` untuk pemilik akun (sesi halaman SSO) dan `/api/pin/verify` + `/api/pin/status` untuk backend
 * aplikasi (HTTP Basic client_id:client_secret klien OIDC; tidak pernah dari browser).
 */
@Controller("api/pin")
export class PinController {
  constructor(
    private readonly pins: PinService,
    private readonly sessions: SessionsService,
    private readonly clients: ClientAuthService,
  ) {}

  private async session(req: Request) {
    const session = await this.sessions.current(req);
    if (!session) throw new UnauthorizedException("Belum masuk.");
    return session;
  }

  private client(req: Request) {
    return this.clients.authenticate(req);
  }

  @Get()
  async status(@Req() req: Request) {
    return this.pins.status((await this.session(req)).accountId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put()
  async set(@Body() dto: SetPinDto, @Req() req: Request) {
    const session = await this.session(req);
    return this.pins.setPin(session.accountId, dto.pin, dto.password, session.createdAt, clientInfo(req));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete()
  async remove(@Body() dto: RemovePinDto, @Req() req: Request) {
    const session = await this.session(req);
    return this.pins.removePin(session.accountId, dto.password, session.createdAt, clientInfo(req));
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post("verify")
  @HttpCode(200)
  verify(@Body() dto: VerifyPinDto, @Req() req: Request) {
    const app = this.client(req);
    return this.pins.verifyPin(dto.sub, dto.pin, app, clientInfo(req));
  }

  @Get("status")
  async appStatus(@Query() query: StatusQuery, @Req() req: Request) {
    this.client(req);
    return this.pins.status(query.sub).catch(() => ({ hasPin: false, blockedUntil: null }));
  }
}
