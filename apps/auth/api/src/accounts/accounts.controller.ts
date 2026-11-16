import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { PROFILE_LIMITS } from "./profile-logic";
import { landingOrigins } from "./landing-origins";
import type { Request, Response } from "express";
import { clientInfo } from "../common/http";
import { AccountsService } from "./accounts.service";
import { SessionsService } from "./sessions.service";

class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

class LoginDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

class EmailDto {
  @IsEmail()
  @MaxLength(200)
  email: string;
}

class TokenDto {
  @IsString()
  @MaxLength(200)
  token: string;
}

class ResetDto extends TokenDto {
  @IsString()
  @MaxLength(200)
  password: string;
}

class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  current?: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

class ProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.phone)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.address)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.occupation)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.workplace)
  workplace?: string;
}

const GENERIC_SENT = { message: "Bila email terdaftar, tautan sudah dikirim. Cek kotak masuk (dan folder spam)." };

/** Akun & sesi halaman SSO (`/api/auth/*`). Halaman aplikasi masuk lewat OIDC, bukan endpoint ini. */
@Controller("api/auth")
export class AccountsController {
  private readonly landingOrigins: string[];

  constructor(
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    config: ConfigService,
  ) {
    this.landingOrigins = landingOrigins(config.get<string>("LANDING_URL"));
  }

  private async requireSession(req: Request) {
    const session = await this.sessions.current(req);
    if (!session) throw new UnauthorizedException("Belum masuk.");
    return session;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("register")
  @HttpCode(202)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    await this.accounts.register(dto, clientInfo(req));
    return { message: "Pendaftaran diterima. Cek email Anda untuk tautan verifikasi." };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("resend-verification")
  @HttpCode(202)
  async resend(@Body() dto: EmailDto) {
    await this.accounts.resendVerification(dto.email);
    return GENERIC_SENT;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verify")
  @HttpCode(200)
  async verify(@Body() dto: TokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const account = await this.accounts.verifyEmail(dto.token, clientInfo(req));
    // Tautan verifikasi membuktikan kepemilikan email → langsung masuk (kecuali akun dinonaktifkan)
    if (!account.disabled) {
      await this.sessions.create(res, account.id, clientInfo(req));
      await this.accounts.markLogin(account.id, clientInfo(req), "verify");
    }
    return this.accounts.view(account.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const account = await this.accounts.authenticate(dto.email, dto.password, clientInfo(req));
    await this.sessions.create(res, account.id, clientInfo(req));
    await this.accounts.markLogin(account.id, clientInfo(req), "password");
    return this.accounts.view(account.id);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req, res);
  }

  /**
   * Status masuk untuk halaman depan workingspace.id (tombol Masuk/Daftar ↔ Dashboard). Dibaca lintas asal dengan cookie
   * sesi; CORS hanya untuk LANDING_URL. Hanya nama yang dikirim.
   */
  @Get("status")
  async status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    res.setHeader("Cache-Control", "no-store");
    if (origin && this.landingOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    const session = await this.sessions.current(req);
    return session ? { signedIn: true, name: session.account.name } : { signedIn: false };
  }

  @Get("me")
  async me(@Req() req: Request) {
    const session = await this.requireSession(req);
    return this.accounts.view(session.accountId);
  }

  @Patch("me")
  async updateMe(@Body() dto: ProfileDto, @Req() req: Request) {
    const session = await this.requireSession(req);
    const { name, ...profile } = dto;
    await this.accounts.updateProfile(session.accountId, name, profile);
    return this.accounts.view(session.accountId);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("forgot-password")
  @HttpCode(202)
  async forgot(@Body() dto: EmailDto) {
    await this.accounts.forgotPassword(dto.email);
    return GENERIC_SENT;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("reset-password")
  @HttpCode(204)
  async reset(@Body() dto: ResetDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.accounts.resetPassword(dto.token, dto.password, clientInfo(req));
    await this.sessions.destroy(req, res);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const session = await this.requireSession(req);
    await this.accounts.changePassword(session.accountId, dto.current, dto.password, session.id, clientInfo(req));
  }

  @Get("sessions")
  async listSessions(@Req() req: Request) {
    const session = await this.requireSession(req);
    const rows = await this.sessions.list(session.accountId);
    return rows.map((row) => ({ ...row, current: row.id === session.id }));
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(@Param("id") id: string, @Req() req: Request) {
    const session = await this.requireSession(req);
    await this.sessions.revoke(session.accountId, id);
  }
}
