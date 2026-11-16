import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { hash } from "@node-rs/argon2";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { Request } from "express";
import { AccountsService } from "../accounts/accounts.service";
import { normalizeEmail, passwordProblem } from "../accounts/password-policy";
import { SessionsService } from "../accounts/sessions.service";
import { clientInfo } from "../common/http";
import { PrismaService } from "../prisma/prisma.service";
import {
  ACCOUNT_STATUSES,
  type AccountStatusFilter,
  accountChangeProblem,
  accountSearch,
  accountStatusFilter,
} from "./admin-logic";

const ROLES = ["admin", "member"] as const;

class ListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(5)
  @Max(100)
  size?: number;
}

class CreateAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  /** Kosong = dikirim email undangan untuk membuat kata sandi sendiri */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsBoolean()
  superAdmin?: boolean;

  /** Akses aplikasi awal: { akasha: "member" } */
  @IsOptional()
  apps?: Record<string, "admin" | "member">;
}

class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsBoolean()
  superAdmin?: boolean;
}

class MembershipDto {
  @IsIn(ROLES)
  role: "admin" | "member";
}

class UpdateAppDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ["http", "https"] })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Role untuk akun yang mendaftar sendiri; null = tidak otomatis */
  @IsOptional()
  @IsIn([...ROLES, null])
  selfSignup?: "admin" | "member" | null;
}

/** Pengelolaan akun & akses aplikasi (`/api/admin/*`) — hanya super admin ekosistem, tanpa melihat data aplikasi. */
@Controller("api/admin")
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
  ) {}

  private async admin(req: Request) {
    const session = await this.sessions.current(req);
    if (!session) throw new UnauthorizedException("Belum masuk.");
    if (!session.account.superAdmin) throw new ForbiddenException("Khusus super admin.");
    return session.account;
  }

  private async findAccount(id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("Akun tidak ditemukan.");
    return account;
  }

  private async findApp(key: string) {
    const app = await this.prisma.app.findUnique({ where: { key } });
    if (!app) throw new NotFoundException("Aplikasi tidak ditemukan.");
    return app;
  }

  /** Ringkasan angka untuk halaman admin (tanpa data pribadi). */
  @Get("stats")
  async stats(@Req() req: Request) {
    await this.admin(req);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, superAdmins, active30d, unverified, disabled] = await Promise.all([
      this.prisma.account.count(),
      this.prisma.account.count({ where: { superAdmin: true } }),
      this.prisma.account.count({ where: { lastLoginAt: { gte: since }, disabled: false } }),
      this.prisma.account.count({ where: accountStatusFilter("unverified") }),
      this.prisma.account.count({ where: { disabled: true } }),
    ]);
    return { total, superAdmins, active30d, unverified, disabled };
  }

  @Get("accounts")
  async list(@Query() query: ListQuery, @Req() req: Request) {
    await this.admin(req);
    const size = query.size ?? 20;
    const page = query.page ?? 1;
    const where = { ...accountSearch(query.q), ...accountStatusFilter(query.status) };
    const [total, rows] = await Promise.all([
      this.prisma.account.count({ where }),
      this.prisma.account.findMany({
        where,
        orderBy: [{ superAdmin: "desc" }, { name: "asc" }],
        skip: (page - 1) * size,
        take: size,
        include: { memberships: true, identities: { select: { provider: true } } },
      }),
    ]);
    return {
      total,
      page,
      size,
      items: rows.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        emailVerified: !!a.emailVerifiedAt,
        disabled: a.disabled,
        superAdmin: a.superAdmin,
        hasPassword: !!a.passwordHash,
        google: a.identities.some((i) => i.provider === "google"),
        phone: a.phone,
        occupation: a.occupation,
        workplace: a.workplace,
        lastLoginAt: a.lastLoginAt,
        createdAt: a.createdAt,
        apps: Object.fromEntries(a.memberships.map((m) => [m.appKey, m.role])),
      })),
    };
  }

  @Post("accounts")
  async create(@Body() dto: CreateAccountDto, @Req() req: Request) {
    const admin = await this.admin(req);
    const email = normalizeEmail(dto.email);
    if (await this.prisma.account.findUnique({ where: { email } }))
      throw new BadRequestException("Email sudah terdaftar.");
    if (dto.password) {
      const problem = passwordProblem(dto.password, { email, name: dto.name });
      if (problem) throw new BadRequestException(problem);
    }
    const apps = Object.entries(dto.apps ?? {});
    for (const [key, role] of apps) {
      await this.findApp(key);
      if (!ROLES.includes(role)) throw new BadRequestException(`Role tidak valid untuk ${key}.`);
    }
    const account = await this.prisma.account.create({
      data: {
        email,
        name: dto.name.trim(),
        superAdmin: dto.superAdmin ?? false,
        // Kata sandi dari admin = email dianggap terverifikasi (admin yang menjamin); undangan = terverifikasi saat kata sandi dibuat
        passwordHash: dto.password ? await hash(dto.password) : null,
        emailVerifiedAt: dto.password ? new Date() : null,
        memberships: { create: apps.map(([appKey, role]) => ({ appKey, role })) },
      },
    });
    if (!dto.password) await this.accounts.sendPasswordLink(account, true);
    await this.accounts.log(account.id, "admin_created", clientInfo(req), { by: admin.id, invited: !dto.password });
    return { id: account.id, invited: !dto.password };
  }

  @Patch("accounts/:id")
  async update(@Param("id") id: string, @Body() dto: UpdateAccountDto, @Req() req: Request) {
    const admin = await this.admin(req);
    const target = await this.findAccount(id);
    const activeSuperAdmins = await this.prisma.account.count({ where: { superAdmin: true, disabled: false } });
    const problem = accountChangeProblem(dto, {
      self: target.id === admin.id,
      targetSuperAdmin: target.superAdmin && !target.disabled,
      activeSuperAdmins,
    });
    if (problem) throw new BadRequestException(problem);
    await this.prisma.account.update({
      where: { id },
      data: { name: dto.name?.trim(), disabled: dto.disabled, superAdmin: dto.superAdmin },
    });
    if (dto.disabled) await this.accounts.revokeAllSessions(id);
    const changed = Object.keys(dto).filter((k) => dto[k as keyof UpdateAccountDto] !== undefined);
    await this.accounts.log(id, "admin_updated", clientInfo(req), { by: admin.id, changed, ...dto });
    return { success: true };
  }

  @Post("accounts/:id/password-link")
  @HttpCode(202)
  async passwordLink(@Param("id") id: string, @Req() req: Request) {
    const admin = await this.admin(req);
    const target = await this.findAccount(id);
    if (target.disabled) throw new BadRequestException("Akun nonaktif. Aktifkan dulu.");
    await this.accounts.sendPasswordLink(target, !target.passwordHash);
    await this.accounts.log(id, "admin_password_link", clientInfo(req), { by: admin.id });
    return { message: `Tautan dikirim ke ${target.email}.` };
  }

  @Post("accounts/:id/sign-out")
  @HttpCode(204)
  async signOut(@Param("id") id: string, @Req() req: Request) {
    const admin = await this.admin(req);
    await this.findAccount(id);
    await this.accounts.revokeAllSessions(id);
    await this.accounts.log(id, "admin_sign_out", clientInfo(req), { by: admin.id });
  }

  @Put("accounts/:id/apps/:app")
  async grant(@Param("id") id: string, @Param("app") app: string, @Body() dto: MembershipDto, @Req() req: Request) {
    const admin = await this.admin(req);
    await this.findAccount(id);
    await this.findApp(app);
    await this.prisma.appMembership.upsert({
      where: { accountId_appKey: { accountId: id, appKey: app } },
      create: { accountId: id, appKey: app, role: dto.role },
      update: { role: dto.role },
    });
    await this.accounts.log(id, "admin_app_access", clientInfo(req), { by: admin.id, app, role: dto.role });
    return { success: true };
  }

  @Delete("accounts/:id/apps/:app")
  @HttpCode(204)
  async revoke(@Param("id") id: string, @Param("app") app: string, @Req() req: Request) {
    const admin = await this.admin(req);
    await this.prisma.appMembership.deleteMany({ where: { accountId: id, appKey: app } });
    await this.accounts.log(id, "admin_app_access", clientInfo(req), { by: admin.id, app, role: null });
  }

  @Get("accounts/:id/events")
  async events(@Param("id") id: string, @Req() req: Request) {
    await this.admin(req);
    await this.findAccount(id);
    return this.prisma.securityEvent.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, event: true, ip: true, userAgent: true, detail: true, createdAt: true },
    });
  }

  @Get("apps")
  async apps(@Req() req: Request) {
    await this.admin(req);
    const apps = await this.prisma.app.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { memberships: true } } },
    });
    return apps.map(({ _count, ...app }) => ({ ...app, members: _count.memberships }));
  }

  @Patch("apps/:key")
  async updateApp(@Param("key") key: string, @Body() dto: UpdateAppDto, @Req() req: Request) {
    const admin = await this.admin(req);
    await this.findApp(key);
    const app = await this.prisma.app.update({
      where: { key },
      data: { name: dto.name?.trim(), url: dto.url, description: dto.description, selfSignup: dto.selfSignup },
    });
    await this.accounts.log(null, "admin_app_updated", clientInfo(req), { by: admin.id, app: key, ...dto });
    return app;
  }
}
