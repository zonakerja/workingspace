import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import { AccountsService } from "../accounts/accounts.service";
import { SessionsService } from "../accounts/sessions.service";
import { clientInfo } from "../common/http";
import { PrismaService } from "../prisma/prisma.service";
import { canOpenApp } from "./oidc-config";
import { OidcService } from "./oidc.service";

class InteractionLoginDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

/**
 * Alur masuk OIDC. oidc-provider mengarahkan browser ke `/interaction/:uid` (cookie interaksi ber-path itu), lalu:
 * sudah masuk SSO → langsung kembali ke aplikasi; belum → halaman `/login?uid=` (SPA) yang memanggil
 * `POST /interaction/:uid/login`.
 */
@Controller("interaction")
export class InteractionController {
  constructor(
    private readonly oidc: OidcService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async details(req: Request, res: Response, uid: string) {
    try {
      const details = await this.oidc.provider.interactionDetails(req, res);
      if (details.uid !== uid) throw new Error("uid");
      return details;
    } catch {
      throw new NotFoundException("Sesi masuk sudah kedaluwarsa. Buka lagi aplikasinya.");
    }
  }

  private async appOf(clientId: string) {
    return this.prisma.app.findUnique({ where: { key: clientId } });
  }

  /** Akun boleh masuk ke aplikasi klien ini? Galat Bahasa Indonesia bila tidak. */
  private async assertAccess(accountId: string, clientId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { memberships: true },
    });
    this.accounts.assertUsable(account);
    if (!canOpenApp(account, clientId)) {
      const app = await this.appOf(clientId);
      throw new ForbiddenException({
        message: `Akun Anda belum punya akses ke ${app?.name ?? clientId} (atau masa aksesnya sudah berakhir). Ajukan akses dari halaman akun Workingspace.`,
        code: "APP_FORBIDDEN",
      });
    }
  }

  private finish(req: Request, res: Response, accountId: string) {
    return this.oidc.provider.interactionResult(
      req,
      res,
      { login: { accountId, remember: true } },
      { mergeWithLastSubmission: false },
    );
  }

  /** Persetujuan otomatis: semua klien = aplikasi ekosistem sendiri (first-party), tanpa layar "izinkan akses". */
  private async consent(
    req: Request,
    res: Response,
    details: Awaited<ReturnType<OidcService["provider"]["interactionDetails"]>>,
  ) {
    const { Grant } = this.oidc.provider;
    const clientId = String(details.params.client_id);
    const grant =
      (details.grantId ? await Grant.find(details.grantId) : undefined) ??
      new Grant({ accountId: details.session!.accountId, clientId });
    const missing = details.prompt.details as { missingOIDCScope?: string[]; missingOIDCClaims?: string[] };
    if (missing.missingOIDCScope?.length) grant.addOIDCScope(missing.missingOIDCScope.join(" "));
    if (missing.missingOIDCClaims?.length) grant.addOIDCClaims(missing.missingOIDCClaims);
    const grantId = await grant.save();
    return this.oidc.provider.interactionResult(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
  }

  @Get(":uid")
  async start(@Param("uid") uid: string, @Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res, uid);
    if (details.prompt.name === "consent" && details.session?.accountId)
      return res.redirect(303, await this.consent(req, res, details));
    const clientId = String(details.params.client_id);
    const forceLogin = String(details.params.prompt ?? "")
      .split(" ")
      .includes("login");
    const session = forceLogin ? null : await this.sessions.current(req);
    if (session) {
      try {
        await this.assertAccess(session.accountId, clientId);
        await this.accounts.markLogin(session.accountId, clientInfo(req), `sso:${clientId}`);
        return res.redirect(303, await this.finish(req, res, session.accountId));
      } catch {
        // Tidak punya akses / akun bermasalah → halaman masuk menampilkan pesannya
      }
    }
    // Pemeriksaan diam-diam dari aplikasi (`ws_silent=1`): belum masuk / tanpa akses → kembali ke aplikasi tanpa halaman masuk
    if (details.params.ws_silent === "1") {
      const redirectTo = await this.oidc.provider.interactionResult(
        req,
        res,
        { error: "login_required", error_description: "Belum masuk di akun Workingspace." },
        { mergeWithLastSubmission: false },
      );
      return res.redirect(303, redirectTo);
    }
    return res.redirect(303, `/login?uid=${encodeURIComponent(uid)}`);
  }

  @Get(":uid/details")
  async info(@Param("uid") uid: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const details = await this.details(req, res, uid);
    const clientId = String(details.params.client_id);
    const app = await this.appOf(clientId);
    const session = await this.sessions.current(req);
    let accessError: string | null = null;
    if (session) {
      try {
        await this.assertAccess(session.accountId, clientId);
      } catch (error) {
        accessError =
          error instanceof ForbiddenException ? String((error.getResponse() as { message: string }).message) : null;
      }
    }
    return {
      app: { key: clientId, name: app?.name ?? clientId },
      account: session ? { name: session.account.name, email: session.account.email } : null,
      accessError,
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(":uid/login")
  @HttpCode(200)
  async login(
    @Param("uid") uid: string,
    @Body() dto: InteractionLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const details = await this.details(req, res, uid);
    const account = await this.accounts.authenticate(dto.email, dto.password, clientInfo(req));
    const clientId = String(details.params.client_id);
    await this.assertAccess(account.id, clientId);
    await this.sessions.create(res, account.id, clientInfo(req));
    await this.accounts.markLogin(account.id, clientInfo(req), `password:${clientId}`);
    return { redirectTo: await this.finish(req, res, account.id) };
  }

  /** Lanjut dengan sesi SSO yang sudah ada (tombol "Lanjut sebagai …"). */
  @Post(":uid/continue")
  @HttpCode(200)
  async continueAs(@Param("uid") uid: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const details = await this.details(req, res, uid);
    const session = await this.sessions.current(req);
    if (!session) throw new UnauthorizedException("Belum masuk.");
    const clientId = String(details.params.client_id);
    await this.assertAccess(session.accountId, clientId);
    await this.accounts.markLogin(session.accountId, clientInfo(req), `sso:${clientId}`);
    return { redirectTo: await this.finish(req, res, session.accountId) };
  }

  @Post(":uid/abort")
  @HttpCode(200)
  async abort(@Param("uid") uid: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.details(req, res, uid);
    const redirectTo = await this.oidc.provider.interactionResult(
      req,
      res,
      { error: "access_denied", error_description: "Masuk dibatalkan." },
      { mergeWithLastSubmission: false },
    );
    return { redirectTo };
  }
}
