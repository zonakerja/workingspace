import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { MCP_AUTH_TYPES, type McpAuthType } from "./mcp-connection-logic";
import { McpConnectionsService } from "./mcp-connections.service";

class McpConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  preset?: string;

  @ApiPropertyOptional({ enum: MCP_AUTH_TYPES })
  @IsOptional()
  @IsIn(MCP_AUTH_TYPES)
  authType?: McpAuthType;

  @ApiPropertyOptional({ description: "Token bearer; string kosong = hapus token" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  token?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  agentEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowWrite?: boolean;

  @ApiPropertyOptional({ description: "OAuth client yang didaftarkan sendiri; string kosong = hapus" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  oauthClientId?: string;

  @ApiPropertyOptional({ description: "Client secret (tidak pernah dikembalikan)" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  oauthClientSecret?: string;

  @ApiPropertyOptional({ description: "Scope OAuth dipisah spasi; string kosong = sesuai server" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  oauthScope?: string;

  @ApiPropertyOptional({
    description: "Alat bertanda Hapus yang diizinkan untuk agen (daftar lengkap)",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  agentTools?: string[];
}

class CallToolDto {
  @IsString()
  @MaxLength(200)
  tool!: string;

  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;
}

/** Koneksi ke server MCP aplikasi luar milik user. Callback OAuth publik (dibuka browser), sisanya wajib login. */
@ApiTags("mcp-connections")
@Controller("mcp-connections")
export class McpConnectionsController {
  constructor(private readonly connections: McpConnectionsService) {}

  /** Alamat tujuan halaman izin aplikasi luar; mengalihkan kembali ke halaman koneksi di Akasha. */
  @Get("oauth/callback")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async callback(
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    res.redirect(await this.connections.oauthCallback(code, state, error));
  }

  @Get("presets")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  presets() {
    return this.connections.presets();
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.connections.list(user);
  }

  @Get(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.connections.get(user, id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: McpConnectionDto) {
    return this.connections.create(user, dto);
  }

  @Patch(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: McpConnectionDto) {
    return this.connections.update(user, id, dto);
  }

  @Delete(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.connections.remove(user, id);
  }

  @Post(":id/connect")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  connect(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.connections.connect(user, id);
  }

  @Post(":id/refresh")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  refresh(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.connections.refresh(user, id);
  }

  /** Jalankan satu alat dari halaman koneksi (oleh pemilik). */
  @Post(":id/call")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  call(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CallToolDto) {
    return this.connections.callTool(user, id, dto.tool, dto.arguments ?? {}, false);
  }
}
