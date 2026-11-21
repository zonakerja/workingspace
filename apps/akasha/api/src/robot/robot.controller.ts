import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import {
  AnswerDto,
  SimanTicketDto,
  CaptureDto,
  CredentialsDto,
  FillRenaksiDto,
  SubmitRenaksiDto,
  RegisterOutgoingDto,
  SendOutgoingDto,
  RenaksiScopeDto,
  RobotInputDto,
  SyncSkpDto,
  UpdateConnectorDto,
} from "./robot.dto";
import { RenaksiProposalsService } from "./renaksi-proposals.service";
import { RobotService } from "./robot.service";
import { SimanDocumentsService } from "./siman-documents.service";

/** Konektor robot SRIKANDI & e-Kinerja (tab Connector di Laporan Kinerja & SRIKANDI). Data & sesi milik user sendiri. */
@ApiTags("robot")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("robot")
export class RobotController {
  constructor(
    private readonly robot: RobotService,
    private readonly renaksi: RenaksiProposalsService,
    private readonly simanDocuments: SimanDocumentsService,
  ) {}

  /** e-Kinerja: cakupan kegiatan Working Space yang dikecualikan dari renaksi (Area / Project / Lepas); berlaku juga untuk agen. */
  @Get("ekinerja/renaksi/scope")
  async renaksiScope(@CurrentUser() user: AuthUser) {
    return { excluded: await this.renaksi.excluded(user.id) };
  }

  @Put("ekinerja/renaksi/scope")
  setRenaksiScope(@CurrentUser() user: AuthUser, @Body() dto: RenaksiScopeDto) {
    return this.renaksi.setExcluded(user.id, dto.excluded);
  }

  @Get("status")
  status() {
    return this.robot.status();
  }

  @Get("connectors")
  connectors(@CurrentUser() user: AuthUser) {
    return this.robot.connectors(user.id);
  }

  @Patch("connectors/:system")
  update(@CurrentUser() user: AuthUser, @Param("system") system: string, @Body() dto: UpdateConnectorDto) {
    return this.robot.update(user.id, system, dto);
  }

  /** Simpan kredensial ke brankas (butuh kata sandi akun Akasha). Tidak ada endpoint untuk membaca kembali kredensial. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(200)
  @Post("connectors/:system/credentials")
  setCredentials(@CurrentUser() user: AuthUser, @Param("system") system: string, @Body() dto: CredentialsDto) {
    return this.robot.setCredentials(user.id, system, dto);
  }

  @Delete("connectors/:system/credentials")
  deleteCredentials(@CurrentUser() user: AuthUser, @Param("system") system: string) {
    return this.robot.deleteCredentials(user.id, system);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("connectors/:system/auto-login")
  autoLogin(@CurrentUser() user: AuthUser, @Param("system") system: string) {
    return this.robot.autoLogin(user.id, system);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @HttpCode(200)
  @Post("sessions/:id/answer")
  answer(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AnswerDto) {
    return this.robot.answer(user.id, id, dto.kind, dto.value);
  }

  @Delete("connectors/:system/session")
  forget(@CurrentUser() user: AuthUser, @Param("system") system: string) {
    return this.robot.forget(user.id, system);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("connectors/:system/login")
  startLogin(@CurrentUser() user: AuthUser, @Param("system") system: string) {
    return this.robot.startLogin(user.id, system);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @HttpCode(200)
  @Post("connectors/:system/check")
  check(@CurrentUser() user: AuthUser, @Param("system") system: string) {
    return this.robot.check(user.id, system);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post("connectors/:system/capture")
  capture(@CurrentUser() user: AuthUser, @Param("system") system: string, @Body() dto: CaptureDto) {
    return this.robot.capture(user.id, system, dto.url ?? "");
  }

  /** e-Kinerja: ambil SKP & RHK tahun itu dari e-Kinerja (hanya membaca). */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("ekinerja/skp/sync")
  syncSkp(@CurrentUser() user: AuthUser, @Body() dto: SyncSkpDto) {
    return this.robot.syncEkinerjaSkp(user, dto.year);
  }

  /**
   * e-Kinerja: isi Rencana Aksi bulan itu dari entri renaksi yang siap (draf; robot tidak pernah mengirim penilaian ke
   * atasan).
   */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @HttpCode(200)
  @Post("ekinerja/renaksi/fill")
  fillRenaksi(@CurrentUser() user: AuthUser, @Body() dto: FillRenaksiDto) {
    return this.robot.fillEkinerjaRenaksi(user, dto.period, dto.dryRun);
  }

  /**
   * e-Kinerja: Kirim Penilaian Ke Atasan satu bulan. `dryRun` (bawaan) = periksa bulan & tombol tanpa mengklik; mengirim
   * wajib PIN keamanan setiap kali dan hanya dari sesi login aplikasi.
   */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("ekinerja/renaksi/submit")
  submitRenaksi(@CurrentUser() user: AuthUser, @Body() dto: SubmitRenaksiDto) {
    return this.robot.submitEkinerjaRenaksi(user, dto.period, { dryRun: dto.dryRun, pin: dto.pin });
  }

  /** e-Kinerja: baca semua bulan Rencana Aksi SKP tahun itu (status, isi, feedback) → potret + impor. Hanya membaca. */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("ekinerja/renaksi/sync")
  syncRenaksi(@CurrentUser() user: AuthUser, @Body() dto: SyncSkpDto) {
    return this.robot.syncEkinerjaRenaksi(user, dto.year);
  }

  /** SRIKANDI: ambil daftar naskah keluar + PDF naskah yang sudah ditandatangani (hanya membaca). */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("srikandi/letters/sync")
  syncLetters(@CurrentUser() user: AuthUser) {
    return this.robot.syncSrikandiLetters(user);
  }

  /**
   * SRIKANDI: daftarkan entri Register Naskah Keluar lewat formulir Registrasi (berhenti di SIMPAN = draf di Log Naskah
   * Keluar; Kirim Konsep tetap oleh user).
   */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("srikandi/register/:id")
  registerOutgoing(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RegisterOutgoingDto) {
    return this.robot.registerSrikandiOutgoing(user, id, dto.dryRun);
  }

  /**
   * SRIKANDI: perbarui konsep yang sudah didaftarkan lewat Edit di Log Naskah Keluar (hanya isian yang berubah; Kirim
   * Konsep tetap oleh user). `dryRun` = baca konsep + rencana perubahan tanpa klik.
   */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("srikandi/register/:id/update")
  updateOutgoing(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RegisterOutgoingDto) {
    return this.robot.updateSrikandiOutgoing(user, id, dto.dryRun);
  }

  /**
   * SRIKANDI: Kirim Konsep entri yang sudah terdaftar (konsep → verifikator). `dryRun` (bawaan) = periksa konsep & tombol
   * tanpa mengklik; mengirim wajib PIN keamanan setiap kali dan hanya dari sesi login aplikasi.
   */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("srikandi/register/:id/send")
  sendOutgoing(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SendOutgoingDto) {
    return this.robot.sendSrikandiOutgoing(user, id, { dryRun: dto.dryRun, pin: dto.pin });
  }

  /**
   * SRIKANDI: ambil daftar Naskah Masuk, Tembusan, Disposisi, Koordinasi, Arahan. Hanya membaca halaman daftar — detail
   * naskah tidak dibuka agar Status Baca di SRIKANDI tidak berubah.
   */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("srikandi/inbox/sync")
  syncInbox(@CurrentUser() user: AuthUser) {
    return this.robot.syncSrikandiInbox(user);
  }

  /** SIMAN: baca satu tiket (info, aset, kelengkapan + unduh berkas, analisis, surat, riwayat). Tidak mengubah tiket. */
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @HttpCode(200)
  @Post("siman/ticket")
  readSimanTicket(@CurrentUser() user: AuthUser, @Body() dto: SimanTicketDto) {
    return this.robot.readSimanTicket(user, dto.ticket.toUpperCase(), { source: dto.source, documents: dto.documents });
  }

  /** SIMAN: dokumen hasil satu tiket (versi ONLYOFFICE, tersunting pemilik atau belum). */
  @Get("siman/requests/:ticket/documents")
  listSimanDocuments(@CurrentUser() user: AuthUser, @Param("ticket") ticket: string) {
    return this.simanDocuments.list(user, ticket, {}).catch(() => ({ tiket: [] }));
  }

  /** SIMAN: ambil daftar Permohonan Pengelolaan + tanda disposisi (tiket di Penetapan Pengelolaan). Hanya membaca. */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @HttpCode(200)
  @Post("siman/requests/sync")
  syncSimanRequests(@CurrentUser() user: AuthUser) {
    return this.robot.syncSimanRequests(user);
  }

  /** SRIKANDI: ambil klasifikasi arsip (Instrumen Kearsipan, ±1.000 baris — terpisah karena lama). Hanya membaca. */
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @HttpCode(200)
  @Post("srikandi/classifications/sync")
  syncClassifications(@CurrentUser() user: AuthUser) {
    return this.robot.syncSrikandiReferences(user, ["classification"]);
  }

  /**
   * SRIKANDI: ambil Instansi Pengirim = pilihan "Dikirimkan melalui" di formulir Registrasi Naskah Keluar (robot membuka
   * formulir & menggulir daftar pilihan; formulir tidak diisi / disimpan).
   */
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @HttpCode(200)
  @Post("srikandi/sender-units/sync")
  syncSenderUnits(@CurrentUser() user: AuthUser) {
    return this.robot.syncSrikandiReferences(user, ["sender_unit"]);
  }

  /** SRIKANDI: ambil referensi menu Pengguna (penandatangan, tujuan, verifikator, tembusan, grup) — hanya membaca. */
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @HttpCode(200)
  @Post("srikandi/references/sync")
  syncReferences(@CurrentUser() user: AuthUser) {
    return this.robot.syncSrikandiReferences(user);
  }

  /** Tayangan browser jarak jauh (JPEG) — dipanggil berkala oleh dialog login. */
  @SkipThrottle()
  @Get("sessions/:id/frame")
  async frame(@CurrentUser() user: AuthUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const frame = await this.robot.frame(user.id, id);
    res.set({
      "Cache-Control": "no-store",
      "X-Robot-Url": encodeURIComponent(frame.url),
      "X-Robot-Title": encodeURIComponent(frame.title),
      "X-Robot-Logged-In": String(frame.loggedIn),
    });
    return new StreamableFile(frame.image, { type: "image/jpeg" });
  }

  @SkipThrottle()
  @HttpCode(200)
  @Post("sessions/:id/input")
  input(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RobotInputDto) {
    return this.robot.input(user.id, id, { ...dto });
  }

  @HttpCode(200)
  @Post("sessions/:id/capture")
  captureSession(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.robot.captureSession(user.id, id);
  }

  @HttpCode(200)
  @Post("sessions/:id/finish")
  finish(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.robot.finishLogin(user.id, id);
  }

  @Delete("sessions/:id")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.robot.cancelLogin(user.id, id);
  }

  @Get("runs")
  runs(@CurrentUser() user: AuthUser, @Query("system") system?: string) {
    return this.robot.runs(user.id, system);
  }

  @Get("runs/:id")
  run(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.robot.run(user.id, id);
  }

  @Get("runs/:id/screenshot")
  async screenshot(@CurrentUser() user: AuthUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    res.set({ "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" });
    return new StreamableFile(await this.robot.screenshot(user.id, id), { type: "image/jpeg" });
  }

  @Delete("runs/:id")
  removeRun(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.robot.removeRun(user.id, id);
  }
}
