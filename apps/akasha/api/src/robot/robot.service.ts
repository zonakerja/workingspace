import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type RobotConnector } from "../generated/prisma/client";
import { AiCrypto } from "../ai/ai-crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { verify } from "@node-rs/argon2";
import { CredentialVault, maskUsername } from "./credential-vault";
import {
  type CaptureResult,
  type EkinerjaMonth,
  type LoginState,
  type PageInfo,
  RobotClient,
  type RobotTarget,
  type StorageState,
} from "./robot-client";
import {
  connectorHosts,
  isRobotSystem,
  normalizeHosts,
  normalizeSystemUrl,
  ROBOT_SYSTEMS,
  robotSessionKey,
  type RobotSystem,
  SYSTEM_INFO,
  urlInConnector,
} from "./robot-logic";
import type { CredentialsDto, UpdateConnectorDto } from "./robot.dto";
import type { AuthUser } from "../common/types/auth-user";
import { RecordsService } from "../records/records.service";
import { cleanRhk, planTargetSync, skpClientId, targetClientId, validSkp } from "./ekinerja-sync";
import {
  buildSyncPlan,
  emptyRows,
  entryPresent,
  entrySignature,
  importCandidates,
  isChanged,
  type PlanEntry,
  type PlanTarget,
  proposalsCoveredBy,
  rowKey,
  type SignedEntry,
  submitBlockers,
} from "./ekinerja-renaksi";
import { todayYmd } from "../integrations/api-token-logic";
import {
  cleanLetter,
  decodeAttachment,
  decodePdf,
  type FetchedLetter,
  type LetterAttachment,
  letterClientId,
  letterResourceId,
  mergeAttachments,
  safeAttachment,
  safePdfName,
} from "./srikandi-sync";
import { UploadsService } from "../uploads/uploads.service";
import {
  ROBOT_JOBS,
  type RobotJobEvent,
  type RobotJobKind,
  type RobotJobTrigger,
  sessionJobKind,
  summarizeRobotJob,
} from "./robot-jobs";
import { PublicVaultsService } from "../uploads/public-vaults";
import { cleanReference, REFERENCE_CATEGORIES, referenceClientId, staleReferences } from "./srikandi-reference";
import {
  buildRegisterFields,
  cleanAttachmentName,
  type OutgoingEntry,
  outgoingSignature,
  registerBlockers,
  registerSizeError,
  sendBlockers,
} from "./srikandi-register";
import { PinService } from "../security/pin.service";
import {
  cleanInboxItem,
  INBOX_KINDS,
  type InboxKind,
  inboxClientId,
  isUnread,
  mergeInboxRecord,
  summarizeInboxSync,
} from "./srikandi-inbox";

/** Tag konteks Resource Global untuk dokumen final bertanda tangan (sama dengan frontend `FINAL_CONTEXT_TAG`). */
const FINAL_CONTEXT_TAG = "Dokumen Final";

/** Sesi login jarak jauh yang sedang terbuka (di memori backend; robot menutupnya sendiri bila menganggur). */
interface LiveLogin {
  userId: string;
  connectorId: string;
  system: RobotSystem;
  startedAt: number;
}

/** Batas umur sesi login jarak jauh di memori backend. */
const LOGIN_TTL_MS = 60 * 60 * 1000;

const asList = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const RUN_SELECT = {
  id: true,
  kind: true,
  status: true,
  url: true,
  title: true,
  note: true,
  error: true,
  screenshotKey: true,
  createdAt: true,
  connector: { select: { system: true } },
} as const;

/**
 * Konektor robot SRIKANDI & e-Kinerja (tahap 6 docs/AI-AGENT.md §21). Akasha menyimpan sesi browser terenkripsi dan —
 * bila pengguna mengaktifkan — kredensial di brankas terenkripsi (kunci khusus, AAD). Login otomatis mengisi nama pengguna
 * & kata sandi; CAPTCHA dan kode OTP **selalu diketik pengguna** (tidak dibaca mesin). Rahasia TOTP tidak pernah disimpan,
 * dan robot tidak pernah menandatangani.
 */
@Injectable()
export class RobotService {
  private readonly logger = new Logger(RobotService.name);
  private readonly crypto: AiCrypto;
  private readonly logins = new Map<string, LiveLogin>();
  /** Tugas robot yang sedang berjalan per `userId:sistem` — satu sesi sistem tidak dipakai dua tugas sekaligus. */
  private readonly busy = new Map<string, { label: string; since: Date }>();
  private readonly jobListeners: ((event: RobotJobEvent) => void | Promise<void>)[] = [];
  /** null = CREDENTIAL_ENCRYPTION_KEY belum diatur → brankas kredensial nonaktif */
  private readonly vault: CredentialVault | null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly robot: RobotClient,
    private readonly records: RecordsService,
    private readonly uploads: UploadsService,
    private readonly storage: ObjectStorageService,
    private readonly vaults: PublicVaultsService,
    private readonly pins: PinService,
  ) {
    this.crypto = new AiCrypto(robotSessionKey(config.getOrThrow<string>("AI_ENCRYPTION_KEY")));
    const credentialKey = config.get<string>("CREDENTIAL_ENCRYPTION_KEY");
    this.vault = credentialKey ? new CredentialVault(credentialKey) : null;
  }

  async status() {
    return { ...(await this.robot.health()), vault: !!this.vault };
  }

  // ---------------------------------------------------------------- Brankas kredensial

  /**
   * Simpan nama pengguna & kata sandi sistem (terenkripsi). Wajib konfirmasi kata sandi akun Akasha agar sesi yang
   * tertinggal terbuka tidak bisa dipakai mengganti kredensial. Kredensial tidak pernah dikembalikan ke browser.
   */
  async setCredentials(userId: string, system: string, dto: CredentialsDto) {
    const vault = this.requireVault();
    await this.confirmAccountPassword(userId, dto.accountPassword);
    const connector = await this.connector(userId, system);
    const username = dto.username.trim();
    const row = await this.prisma.robotConnector.update({
      where: { id: connector.id },
      data: {
        usernameEnc: vault.encrypt(username, CredentialVault.aad(userId, connector.system, "username")),
        passwordEnc: vault.encrypt(dto.password, CredentialVault.aad(userId, connector.system, "password")),
        credentialHint: maskUsername(username),
        credentialsUpdatedAt: new Date(),
      },
    });
    await this.prisma.robotRun.create({
      data: {
        userId,
        connectorId: connector.id,
        kind: "credentials",
        status: "ok",
        note: "Kredensial disimpan / diganti",
      },
    });
    return this.view(row);
  }

  async deleteCredentials(userId: string, system: string) {
    const connector = await this.connector(userId, system);
    const row = await this.prisma.robotConnector.update({
      where: { id: connector.id },
      data: { usernameEnc: null, passwordEnc: null, credentialHint: null, credentialsUpdatedAt: null },
    });
    await this.prisma.robotRun.create({
      data: { userId, connectorId: connector.id, kind: "credentials", status: "ok", note: "Kredensial dihapus" },
    });
    return this.view(row);
  }

  /**
   * Login otomatis: buka halaman login dengan sesi tersimpan → bila belum masuk, isi kredensial dari brankas. Hasil
   * `captcha`/`otp` = pengguna mengetik jawabannya (`answer`); `done` = sesi langsung disimpan.
   */
  async autoLogin(userId: string, system: string) {
    this.pruneLogins();
    const connector = await this.connector(userId, system);
    this.requireUrl(connector);
    const credentials = this.credentials(connector);
    const page = await this.robot.startSession(this.target(connector));
    this.logins.set(page.id, {
      userId,
      connectorId: connector.id,
      system: connector.system as RobotSystem,
      startedAt: Date.now(),
    });
    const state = page.loggedIn ? { ...page, stage: "done" as const } : await this.robot.autofill(page.id, credentials);
    return this.afterLoginStep(userId, page.id, state);
  }

  /** Jawaban CAPTCHA / OTP dari pengguna (kata sandi diisi ulang bila situs mengosongkannya). */
  async answer(userId: string, sessionId: string, kind: "captcha" | "otp", value: string) {
    const live = this.login(userId, sessionId);
    const connector = await this.prisma.robotConnector.findUniqueOrThrow({ where: { id: live.connectorId } });
    const credentials = connector.passwordEnc ? this.credentials(connector) : undefined;
    const state = await this.robot.answer(sessionId, { kind, value, credentials });
    return this.afterLoginStep(userId, sessionId, state);
  }

  private async afterLoginStep(userId: string, sessionId: string, state: LoginState) {
    if (state.stage !== "done") {
      return {
        sessionId,
        stage: state.stage,
        url: state.url,
        title: state.title,
        message: state.message,
        captchaImage: state.captchaImage,
      };
    }
    const connector = await this.finishLogin(userId, sessionId, "Login otomatis berhasil, sesi disimpan");
    return { sessionId, stage: "done" as const, url: state.url, title: state.title, connector };
  }

  private credentials(connector: RobotConnector) {
    const vault = this.requireVault();
    if (!connector.usernameEnc || !connector.passwordEnc) {
      throw new BadRequestException("Simpan nama pengguna & kata sandi dulu (Kredensial).");
    }
    try {
      return {
        username: vault.decrypt(
          connector.usernameEnc,
          CredentialVault.aad(connector.userId, connector.system, "username"),
        ),
        password: vault.decrypt(
          connector.passwordEnc,
          CredentialVault.aad(connector.userId, connector.system, "password"),
        ),
      };
    } catch {
      throw new BadRequestException("Kredensial tersimpan tidak dapat dibuka (kunci brankas berubah?). Simpan ulang.");
    }
  }

  private requireVault() {
    if (!this.vault)
      throw new BadRequestException("Brankas kredensial belum diatur (CREDENTIAL_ENCRYPTION_KEY di server).");
    return this.vault;
  }

  private async confirmAccountPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await verify(user.passwordHash, password))) throw new ForbiddenException("Kata sandi akun Akasha salah.");
  }

  // ---------------------------------------------------------------- Konektor

  /** Semua konektor user (dibuat otomatis dengan alamat bawaan saat pertama dibuka). */
  async connectors(userId: string) {
    const rows = await this.prisma.robotConnector.findMany({ where: { userId } });
    const result = [];
    for (const system of ROBOT_SYSTEMS) {
      // upsert: dua permintaan pertama yang bersamaan tidak bentrok membuat baris yang sama
      let row =
        rows.find((r) => r.system === system) ??
        (await this.prisma.robotConnector.upsert({
          where: { userId_system: { userId, system } },
          create: { userId, system, baseUrl: SYSTEM_INFO[system].defaultUrl },
          update: {},
        }));
      // Konektor lama tanpa alamat mendapat alamat bawaan yang kini tersedia (mis. SIMAN)
      if (!row.baseUrl && SYSTEM_INFO[system].defaultUrl)
        row = await this.prisma.robotConnector.update({
          where: { id: row.id },
          data: { baseUrl: SYSTEM_INFO[system].defaultUrl },
        });
      result.push(this.view(row));
    }
    return result;
  }

  async update(userId: string, system: string, dto: UpdateConnectorDto) {
    const connector = await this.connector(userId, system);
    const data: Prisma.RobotConnectorUpdateInput = {};
    if (dto.baseUrl !== undefined) {
      const baseUrl = normalizeSystemUrl(dto.baseUrl);
      if (!baseUrl) throw new BadRequestException("Alamat harus https://… (tanpa nama pengguna/kata sandi).");
      if (baseUrl !== connector.baseUrl) {
        data.baseUrl = baseUrl;
        // Ganti alamat = sesi lama tidak berlaku
        data.sessionEnc = null;
        data.status = "none";
      }
    }
    if (dto.extraHosts !== undefined) data.extraHosts = normalizeHosts(dto.extraHosts);
    if (dto.loginMarkers !== undefined) {
      data.loginMarkers = [...new Set(dto.loginMarkers.map((m) => m.trim()).filter(Boolean))].slice(0, 10);
    }
    return this.view(await this.prisma.robotConnector.update({ where: { id: connector.id }, data }));
  }

  /** Lupakan sesi tersimpan (logout dari sisi Akasha). */
  async forget(userId: string, system: string) {
    const connector = await this.connector(userId, system);
    return this.view(
      await this.prisma.robotConnector.update({
        where: { id: connector.id },
        data: { sessionEnc: null, status: "none", lastError: null },
      }),
    );
  }

  // ---------------------------------------------------------------- Login jarak jauh

  /** Sesi login yang ditinggalkan (tab ditutup tanpa Selesai/Batal) dibuang dari memori; robot menutupnya sendiri. */
  private pruneLogins() {
    const limit = Date.now() - LOGIN_TTL_MS;
    for (const [id, live] of this.logins) if (live.startedAt < limit) this.logins.delete(id);
  }

  async startLogin(userId: string, system: string) {
    this.pruneLogins();
    const connector = await this.connector(userId, system);
    this.requireUrl(connector);
    const page = await this.robot.startSession(this.target(connector));
    this.logins.set(page.id, {
      userId,
      connectorId: connector.id,
      system: connector.system as RobotSystem,
      startedAt: Date.now(),
    });
    return { sessionId: page.id, url: page.url, title: page.title, loggedIn: page.loggedIn };
  }

  frame(userId: string, sessionId: string) {
    this.login(userId, sessionId);
    return this.robot.frame(sessionId);
  }

  input(userId: string, sessionId: string, event: Record<string, unknown>) {
    const live = this.login(userId, sessionId);
    if (event.type === "goto") {
      const connector = this.prisma.robotConnector.findUniqueOrThrow({ where: { id: live.connectorId } });
      return connector.then((c) => {
        if (
          typeof event.url !== "string" ||
          !urlInConnector(event.url, c.baseUrl, connectorHosts(c.system, asList(c.extraHosts)))
        ) {
          throw new BadRequestException("Alamat di luar sistem konektor ini.");
        }
        return this.robot.input(sessionId, event);
      });
    }
    return this.robot.input(sessionId, event);
  }

  /** Selesai login: sesi browser disimpan terenkripsi; status dari halaman terakhir (masih di halaman login = gagal). */
  async finishLogin(userId: string, sessionId: string, okNote = "Login berhasil, sesi disimpan") {
    const live = this.login(userId, sessionId);
    this.logins.delete(sessionId);
    const result = await this.robot.finish(sessionId);
    const connector = await this.saveState(live.connectorId, result, true);
    await this.log(userId, connector.id, "login", result, {
      note: result.loggedIn ? okNote : "Masih di halaman login — sesi tidak aktif",
    });
    return this.view(connector);
  }

  async cancelLogin(userId: string, sessionId: string) {
    this.login(userId, sessionId);
    this.logins.delete(sessionId);
    await this.robot.close(sessionId);
    return { closed: true };
  }

  // ---------------------------------------------------------------- Pekerjaan robot

  /** Cek sesi: buka halaman utama dengan sesi tersimpan → aktif / kedaluwarsa. */
  /** Cek sesi = tugas "Jaga sesi login": cookie terbaru disimpan ulang; sesi kedaluwarsa dihitung gagal di riwayat. */
  check(userId: string, system: string, trigger: RobotJobTrigger = "button") {
    if (!isRobotSystem(system)) throw new NotFoundException("Sistem tidak dikenal.");
    return this.job(
      userId,
      sessionJobKind(system),
      trigger,
      () => this.checkSession(userId, system),
      (c) => c.status === "active",
    );
  }

  private async checkSession(userId: string, system: string) {
    const connector = await this.connector(userId, system);
    this.requireSession(connector);
    try {
      const result = await this.robot.check({
        ...this.target(connector),
        homeUrl: SYSTEM_INFO[connector.system as RobotSystem]?.homeUrl,
      });
      const saved = await this.saveState(connector.id, result, false);
      await this.log(userId, connector.id, "check", result, {
        note: result.loggedIn ? "Sesi masih aktif" : "Sesi kedaluwarsa — perlu login ulang",
      });
      return this.view(saved);
    } catch (error) {
      await this.fail(userId, connector, "check", error);
      throw error;
    }
  }

  /**
   * Eksplor halaman: tangkapan layar + struktur halaman (snapshot aksesibilitas) untuk memetakan alur pengisian
   * bersama pengguna. Hanya alamat di dalam sistem konektor.
   */
  async capture(userId: string, system: string, url: string) {
    const connector = await this.connector(userId, system);
    this.requireSession(connector);
    const target = url.trim() || connector.baseUrl;
    if (!urlInConnector(target, connector.baseUrl, connectorHosts(connector.system, asList(connector.extraHosts)))) {
      throw new BadRequestException("Alamat di luar sistem konektor ini.");
    }
    try {
      const result = await this.robot.capture({ ...this.target(connector), url: target });
      await this.saveState(connector.id, result, false);
      return await this.storeCapture(
        userId,
        connector.id,
        result,
        result.loggedIn ? "Halaman direkam" : "Diarahkan ke halaman login — sesi kedaluwarsa",
      );
    } catch (error) {
      await this.fail(userId, connector, "capture", error);
      throw error;
    }
  }

  /**
   * Agen membaca satu halaman SIMAN (alat MCP `siman_read_page`): sama dengan Eksplor halaman — buka alamat, rekam struktur
   * & tangkapan layar, tanpa klik — tetapi memakai kunci sistem agar tidak bertabrakan dengan Jaga sesi / tugas lain.
   */
  readSimanPage(userId: string, url: string) {
    return this.exclusive(userId, "siman", "Baca halaman", () => this.capture(userId, "siman", url));
  }

  /**
   * Rekam halaman yang sedang tampil di browser jarak jauh (setelah pengguna membuka menu / formulir sendiri). Sesi
   * login tetap terbuka; sesi tersimpan tidak diubah (baru disimpan saat "Selesai").
   */
  async captureSession(userId: string, sessionId: string) {
    const live = this.login(userId, sessionId);
    const result = await this.robot.captureSession(sessionId);
    return this.storeCapture(userId, live.connectorId, result, "Halaman direkam dari browser jarak jauh");
  }

  private async storeCapture(userId: string, connectorId: string, result: CaptureResult, note: string) {
    const run = await this.log(userId, connectorId, "capture", result, { note, aria: result.aria });
    const key = `robot/${userId}/${run.id}.jpg`;
    const image = Buffer.from(result.screenshot, "base64");
    await this.storage.putObject({
      key,
      body: image,
      contentLength: image.length,
      contentType: "image/jpeg",
      checksum: createHash("sha256").update(image).digest("hex"),
    });
    await this.prisma.robotRun.update({ where: { id: run.id }, data: { screenshotKey: key } });
    return this.run(userId, run.id);
  }

  /**
   * e-Kinerja: ambil daftar SKP + RHK SKP yang beririsan dengan `year` (satu tahun bisa beberapa SKP) lalu simpan sebagai
   * record `skp` & `skp_target` milik user (lewat RecordsService → isolasi & sinkron frontend sama dengan data lain).
   * Robot hanya membaca halaman; tidak ada yang diubah di e-Kinerja.
   */
  syncEkinerjaSkp(user: AuthUser, year: number, trigger: RobotJobTrigger = "button") {
    return this.job(user.id, "ekinerja_skp", trigger, () => this.readEkinerjaSkp(user, year));
  }

  /** Kait setelah tugas sinkron robot selesai (riwayat Otomasi). */
  onJobFinished(listener: (event: RobotJobEvent) => void | Promise<void>) {
    this.jobListeners.push(listener);
  }

  /**
   * Jalankan `fn` dengan kunci per user + sistem: tugas kedua pada sistem yang sama ditolak 409 (sesi browser yang sama
   * tidak dipakai dua tugas sekaligus, mis. jadwal yang bertepatan dengan tombol).
   */
  private async exclusive<T>(userId: string, system: RobotSystem, label: string, fn: () => Promise<T>): Promise<T> {
    const key = `${userId}:${system}`;
    const running = this.busy.get(key);
    if (running) {
      const since = running.since.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      });
      throw new ConflictException(
        `Robot ${SYSTEM_INFO[system].label} sedang menjalankan "${running.label}" (mulai ${since}). Coba lagi setelah selesai.`,
      );
    }
    this.busy.set(key, { label, since: new Date() });
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }

  /** Tugas sinkron baca-saja: kunci sistem + peristiwa selesai (berhasil/gagal) untuk riwayat Otomasi. */
  private async job<T>(
    userId: string,
    kind: RobotJobKind,
    trigger: RobotJobTrigger,
    fn: () => Promise<T>,
    succeeded: (result: T) => boolean = () => true,
  ) {
    const { system, label } = ROBOT_JOBS[kind];
    return this.exclusive(userId, system, label, async () => {
      const startedAt = new Date();
      // Kait ditunggu (riwayat sudah tercatat saat respons kembali), kegagalannya tidak menggagalkan tugas
      const emit = async (ok: boolean, message: string) => {
        const event = { userId, kind, trigger, startedAt, finishedAt: new Date(), ok, message };
        for (const listener of this.jobListeners) {
          try {
            await listener(event);
          } catch (error) {
            this.logger.warn(`Kait tugas robot gagal: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };
      let result: T;
      try {
        result = await fn();
      } catch (error) {
        await emit(false, (error instanceof Error ? error.message : String(error)).slice(0, 500));
        throw error;
      }
      await emit(succeeded(result), summarizeRobotJob(kind, result));
      return result;
    });
  }

  private async readEkinerjaSkp(user: AuthUser, year: number) {
    const connector = await this.connector(user.id, "ekinerja");
    this.requireSession(connector);
    let result: Awaited<ReturnType<RobotClient["ekinerjaSkp"]>>;
    try {
      result = await this.robot.ekinerjaSkp({ ...this.target(connector), year });
    } catch (error) {
      await this.fail(user.id, connector, "sync", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    if (!result.loggedIn) {
      await this.log(user.id, connector.id, "sync", result, { note: "Sesi kedaluwarsa — login ulang lalu coba lagi" });
      throw new BadRequestException("Sesi e-Kinerja kedaluwarsa. Login ulang di e-Kinerja → Connector.");
    }

    const syncedAt = new Date().toISOString();
    const skps = result.skps.filter(validSkp);
    let rhkCount = 0;
    for (const skp of skps) {
      const skpId = skpClientId(skp.externalId);
      await this.records.upsert(
        "skp",
        skpId,
        {
          payload: {
            id: skpId,
            externalId: skp.externalId,
            startDate: skp.startDate,
            endDate: skp.endDate,
            status: String(skp.status ?? "").slice(0, 60),
            approach: String(skp.approach ?? "").slice(0, 60),
            appraiser: String(skp.appraiser ?? "").slice(0, 200),
            syncedAt,
          },
        },
        user,
      );
      if (!skp.rhk) continue;
      const rhk = cleanRhk(skp.rhk);
      const ids: string[] = [];
      for (const [index, item] of rhk.entries()) {
        const id = targetClientId(skp.externalId, item.section, item.name);
        ids.push(id);
        await this.records.upsert(
          "skp_target",
          id,
          {
            payload: {
              id,
              skpId,
              year: Number(skp.startDate.slice(0, 4)),
              name: item.name,
              section: item.section,
              leader: item.leader,
              leaderIndicator: item.leaderIndicator,
              indicators: item.indicators,
              order: index + 1,
            },
          },
          user,
        );
      }
      rhkCount += rhk.length;
      const existing = await this.prisma.skpTarget.findMany({
        where: { userId: user.id, skpId, deletedAt: null },
        select: { clientId: true },
      });
      const usedRows = await this.prisma.actionPlanEntry.findMany({
        where: { userId: user.id, deletedAt: null, targetId: { in: existing.map((e) => e.clientId) } },
        select: { targetId: true },
      });
      const plan = planTargetSync(
        existing.map((e) => e.clientId),
        ids,
        new Set(usedRows.map((r) => r.targetId).filter((id): id is string => !!id)),
      );
      for (const id of plan.remove) await this.records.remove("skp_target", id, {}, user, { trash: false });
      for (const id of plan.stale) {
        const current = await this.records.findOne("skp_target", id, {}, user);
        await this.records.upsert("skp_target", id, { payload: { ...current.payload, stale: true } }, user);
      }
    }
    const detailed = skps.filter((s) => s.rhk).length;
    await this.log(user.id, connector.id, "sync", result, {
      note: `SKP ${year}: ${skps.length} SKP terbaca, RHK diambil dari ${detailed} SKP (${rhkCount} RHK)`,
    });
    return { year, skps: skps.length, detailed, rhk: rhkCount };
  }

  /**
   * e-Kinerja: samakan Rencana Aksi satu bulan dengan entri Akasha. Urutan: (1) baca bulan di e-Kinerja → potret +
   * impor butir yang hanya ada di e-Kinerja (agar tidak hilang), (2) robot mode sinkron: indikator baru dicentang, butir
   * kurang ditambah, baris yang isinya berubah / milik entri yang ditandai hapus ditulis ulang. Robot **tidak pernah**
   * menekan "Kirim Penilaian Ke Atasan"; bulan yang sudah diajukan dilewati (terkunci). Entri yang semua butirnya terbaca
   * → `filled` + `pushedSignature` (pengenal perubahan berikutnya).
   */
  fillEkinerjaRenaksi(user: AuthUser, period: string, dryRun = false) {
    return this.exclusive(user.id, "ekinerja", "Isi Rencana Aksi", () =>
      this.writeEkinerjaRenaksi(user, period, dryRun),
    );
  }

  private async writeEkinerjaRenaksi(user: AuthUser, period: string, dryRun: boolean) {
    const connector = await this.connector(user.id, "ekinerja");
    this.requireSession(connector);
    const { entries, targets, skps } = await this.renaksiData(user);
    const skpIds = [
      ...new Set(
        entries
          .filter((e) => e.period === period)
          .map((e) => e.skpId ?? targets.find((t) => t.id === e.targetId)?.skpId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (!skpIds.length) throw new BadRequestException("Belum ada entri renaksi berSKP di bulan ini.");

    const results: {
      skp: string;
      status: string;
      added: number;
      rewritten: number;
      planned?: number;
      rows?: unknown[];
      missing: string[];
    }[] = [];
    let added = 0;
    let filled = 0;
    let imported = 0;
    for (const skpId of skpIds) {
      const skp = skps.find((s) => s.id === skpId);
      if (!skp?.externalId) throw new BadRequestException("SKP entri tidak ditemukan — Ambil dari e-Kinerja dulu.");
      // 1) Baca dulu: potret bulan + impor butir yang hanya ada di e-Kinerja
      const read = await this.readRenaksiMonths(user, connector, skp);
      imported += await this.applyRenaksiSnapshot(user, skp, read.months);
      const monthNo = Number(period.slice(5, 7));
      const month = read.months.find((m) => m.month === monthNo);
      if (month && (month.status === "submitted" || month.status === "rated")) {
        results.push({ skp: skp.externalId, status: "submitted", added: 0, rewritten: 0, missing: [] });
        continue;
      }
      // 2) Isian lengkap bulan itu (setelah impor) → robot mode sinkron
      const fresh = await this.renaksiData(user);
      const own = fresh.entries.filter(
        (e) => e.period === period && (e.skpId ?? fresh.targets.find((t) => t.id === e.targetId)?.skpId) === skpId,
      );
      let plan = buildSyncPlan(own, fresh.targets, period).bySkp.get(skpId);
      if (!plan?.rows.length) {
        if (!own.some((e) => e.deleted)) continue;
        // Semua isian dihapus: e-Kinerja mewajibkan minimal satu indikator → baris yang berisi dikosongkan (ditulis
        // ulang tanpa butir), baris indikatornya tetap ada
        const rows = emptyRows(
          month?.rows ?? [],
          fresh.targets.filter((t) => t.skpId === skpId),
        );
        if (!rows.length) continue;
        plan = { rows, entryIds: [] };
      }
      let result: Awaited<ReturnType<RobotClient["ekinerjaRenaksi"]>>;
      try {
        result = await this.robot.ekinerjaRenaksi({
          ...this.target(connector),
          skpExternalId: skp.externalId,
          period,
          rows: plan.rows,
          dryRun,
          mode: "sync",
        });
      } catch (error) {
        await this.fail(user.id, connector, "fill", error);
        throw error;
      }
      await this.saveState(connector.id, result, false);
      if (!result.loggedIn) {
        await this.log(user.id, connector.id, "fill", result, {
          note: "Sesi kedaluwarsa — login ulang lalu coba lagi",
        });
        throw new BadRequestException("Sesi e-Kinerja kedaluwarsa. Login ulang di e-Kinerja → Connector.");
      }
      if (dryRun) {
        // Periksa saja: tidak ada yang diubah di e-Kinerja (potret & impor tetap diperbarui dari bacaan)
        results.push({
          skp: skp.externalId,
          status: result.status,
          added: 0,
          rewritten: (result as { rewrite?: string[] }).rewrite?.length ?? 0,
          planned: result.planned?.length ?? 0,
          rows: result.rows,
          missing: result.missing,
        });
        continue;
      }
      const filledAt = new Date().toISOString();
      for (const entry of own) {
        const target = fresh.targets.find((t) => t.id === entry.targetId);
        if (entry.deleted) {
          if (result.status === "filled") {
            await this.records.remove("action_plan_entry", entry.id, {}, user, { trash: false });
            // Brankas bukti entri yang dihapus ikut dihapus: tautannya tidak lagi dirujuk e-Kinerja
            await this.vaults.removeForEntry(user, entry.id, (entry as { vaultId?: string }).vaultId);
          }
          continue;
        }
        if (!entryPresent(entry, target, result.rows)) continue;
        await this.records.upsert(
          "action_plan_entry",
          entry.id,
          { payload: { ...entry, ...this.pushedFields(entry), status: "filled", filledAt } },
          user,
        );
        filled += 1;
      }
      await this.saveMonth(user, skp, monthNo, { status: "draft", rows: result.rows });
      added += result.added.length;
      const rewritten = result.rewritten?.length ?? 0;
      results.push({
        skp: skp.externalId,
        status: result.status,
        added: result.added.length,
        rewritten,
        missing: result.missing,
      });
      const note =
        result.status === "submitted"
          ? `Rencana Aksi ${period}: bulan sudah diajukan — tidak diisi`
          : `Rencana Aksi ${period}: ${result.checked.length} indikator dicentang, ${result.unchecked?.length ?? 0} dilepas, ` +
            `${rewritten} baris ditulis ulang, ${result.added.length} butir ditambahkan (draf, belum dikirim)`;
      const run = await this.log(user.id, connector.id, "fill", result, { note });
      if (result.screenshot) {
        const image = Buffer.from(result.screenshot, "base64");
        const key = `robot/${user.id}/${run.id}.jpg`;
        await this.storage.putObject({
          key,
          body: image,
          contentLength: image.length,
          contentType: "image/jpeg",
          checksum: createHash("sha256").update(image).digest("hex"),
        });
        await this.prisma.robotRun.update({ where: { id: run.id }, data: { screenshotKey: key } });
      }
    }
    return { period, added, filled, imported, results };
  }

  /**
   * e-Kinerja: **Kirim Penilaian Ke Atasan** satu bulan. Hanya pemilik dari aplikasi Akasha yang bisa mengirim, dan setiap
   * kali wajib PIN keamanan (`PinService.confirmAction`; token agen / MCP selalu ditolak). `dryRun` (bawaan) = robot
   * membuka Rencana Aksi, memeriksa isi bulan sama dengan Akasha & lengkap, dan menandai tombol tanpa mengklik — tanpa PIN.
   * Tidak ada jalur agen, kebijakan otomatis, atau jadwal yang memanggil ini.
   */
  submitEkinerjaRenaksi(user: AuthUser, period: string, options: { dryRun?: boolean; pin?: string }) {
    return this.exclusive(user.id, "ekinerja", "Kirim Penilaian", () =>
      this.submitEkinerjaMonth(user, period, options.dryRun !== false, options.pin),
    );
  }

  private async submitEkinerjaMonth(user: AuthUser, period: string, dryRun: boolean, pin: string | undefined) {
    const connector = await this.connector(user.id, "ekinerja");
    this.requireSession(connector);
    const { entries, targets, skps } = await this.renaksiData(user);
    const skpOf = (e: SignedEntry & { skpId?: string }) => e.skpId ?? targets.find((t) => t.id === e.targetId)?.skpId;
    const own = entries.filter((e) => e.period === period);
    const skpIds = [...new Set(own.map(skpOf).filter((id): id is string => !!id))];
    if (skpIds.length > 1) {
      throw new BadRequestException("Bulan ini memakai lebih dari satu SKP — kirim penilaian langsung dari e-Kinerja.");
    }
    const skp = skps.find((s) => s.id === skpIds[0]);
    if (skpIds.length && !skp?.externalId) {
      throw new BadRequestException("SKP entri tidak ditemukan — Ambil dari e-Kinerja dulu.");
    }
    const month = skp
      ? await this.records
          .findOne("action_plan_month", `apm-${skp.externalId}-${period}`, {}, user)
          .then((r) => r.payload as { status?: string })
          .catch(() => null)
      : null;
    const blockers = submitBlockers(own, month);
    if (blockers.length || !skp?.externalId) throw new BadRequestException(blockers.join(" "));
    const plan = buildSyncPlan(own, targets, period).bySkp.get(skp.id);
    const expectedKeys = [...new Set((plan?.rows ?? []).map((r) => rowKey(r.rhk, r.indicator)))];
    if (!expectedKeys.length) throw new BadRequestException("Isian Akasha bulan ini tidak lengkap.");
    // PIN diperiksa sebelum robot dipanggil: salah PIN tidak pernah sampai ke e-Kinerja
    if (!dryRun) await this.pins.confirmAction(user, pin);

    let result: Awaited<ReturnType<RobotClient["ekinerjaSubmit"]>>;
    try {
      result = await this.robot.ekinerjaSubmit({
        ...this.target(connector),
        skpExternalId: skp.externalId,
        period,
        expectedKeys,
        dryRun,
        ...(dryRun ? {} : { confirm: "KIRIM_PENILAIAN" as const }),
      });
    } catch (error) {
      await this.fail(user.id, connector, "fill", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    const label = `Rencana Aksi ${period}`;
    const diff = result.difference;
    const messages: Record<typeof result.status, string> = {
      logged_out: "Sesi e-Kinerja kedaluwarsa. Login ulang di e-Kinerja → Connector.",
      not_found: `Blok bulan ${result.month} tidak ditemukan di halaman Rencana Aksi e-Kinerja.`,
      already_submitted: `${label} sudah dikirim ke atasan di e-Kinerja${result.message ? ` (${result.message})` : ""} — jalankan Pantau e-Kinerja.`,
      not_ready: `Tombol Kirim Penilaian Ke Atasan tidak tersedia: ${result.message}`,
      mismatch: `Isi e-Kinerja berbeda dengan Akasha (${diff?.onlyEkinerja.length ?? 0} baris hanya di e-Kinerja, ${diff?.onlyAkasha.length ?? 0} hanya di Akasha) — Pantau lalu Kirim perubahan dulu. Robot berhenti tanpa mengirim.`,
      incomplete: `${result.incomplete.length} baris indikator di e-Kinerja belum lengkap (renaksi/realisasi/bukti kosong) — robot berhenti tanpa mengirim.`,
      ready: `Kirim Penilaian (periksa, tidak dikirim): ${label} sama dengan Akasha & lengkap, tombol Kirim Penilaian Ke Atasan ditemukan`,
      unconfirmed: `e-Kinerja menampilkan dialog yang tidak dikenali robot, jadi dibatalkan tanpa mengirim: ${result.message}`,
      failed: `e-Kinerja menolak Kirim Penilaian: ${result.message}`,
      unknown: `Kirim Penilaian diklik tetapi hasilnya belum pasti — jalankan Pantau e-Kinerja. ${result.message}`,
      sent: `Kirim Penilaian: ${label} dikirim ke atasan`,
    };
    const run = await this.log(user.id, connector.id, "fill", result, {
      note: messages[result.status].slice(0, 1_000),
    });
    await this.saveRunScreenshot(user.id, run.id, result.screenshot);
    if (result.status !== "ready" && result.status !== "sent") {
      throw new BadRequestException(messages[result.status]);
    }
    if (result.status === "sent") {
      // Bulan terkunci di Akasha sampai Pantau berikutnya membaca tanggal pengajuan resmi dari e-Kinerja
      await this.saveMonth(user, skp, Number(period.slice(5, 7)), {
        status: "submitted",
        submittedAt: todayYmd(new Date()),
        submittedFromAkasha: true,
      });
    }
    return { status: result.status, message: messages[result.status], runId: run.id };
  }

  /**
   * e-Kinerja: baca semua bulan Rencana Aksi SKP tahun itu → potret `action_plan_month` (status draf/diajukan/dinilai,
   * tanggal pengajuan, rating, isi, feedback), impor butir yang hanya ada di e-Kinerja pada bulan draf, dan tandai entri
   * yang isinya sudah ada di e-Kinerja. Hanya membaca e-Kinerja.
   */
  syncEkinerjaRenaksi(user: AuthUser, year: number, trigger: RobotJobTrigger = "button") {
    return this.job(user.id, "ekinerja_renaksi", trigger, () => this.readEkinerjaRenaksi(user, year));
  }

  private async readEkinerjaRenaksi(user: AuthUser, year: number) {
    const connector = await this.connector(user.id, "ekinerja");
    this.requireSession(connector);
    const { skps } = await this.renaksiData(user);
    const list = skps.filter(
      (s) => s.externalId && (s.startDate ?? "").slice(0, 4) <= String(year) && (s.endDate ?? "9999") >= String(year),
    );
    if (!list.length) throw new BadRequestException("Belum ada SKP tahun ini — Ambil SKP & RHK dari e-Kinerja dulu.");
    let imported = 0;
    const months: { skp: string; period: string; status: string; submittedAt?: string }[] = [];
    for (const skp of list) {
      const read = await this.readRenaksiMonths(user, connector, skp);
      const importedHere = await this.applyRenaksiSnapshot(user, skp, read.months);
      imported += importedHere;
      for (const m of read.months) {
        months.push({
          skp: skp.externalId!,
          period: this.monthPeriod(skp, m.month),
          status: m.status,
          submittedAt: m.submittedAt,
        });
      }
      await this.log(user.id, connector.id, "sync", read, {
        note: `Rencana Aksi SKP ${skp.externalId}: ${read.months.length} bulan terbaca, ${importedHere} entri diimpor`,
      });
    }
    return { year, skps: list.length, imported, months };
  }

  private async renaksiData(user: AuthUser) {
    const own = <T>(list: { payload: Record<string, unknown>; share?: unknown }[]) =>
      list.filter((r) => !r.share).map((r) => r.payload as T);
    return {
      // Usulan agen (`proposed`) belum diputuskan pemilik: tidak pernah diisikan ke e-Kinerja
      entries: own<SignedEntry & { pushed?: PlanEntry }>(
        (await this.records.findMany("action_plan_entry", {}, user)).filter((r) => !r.payload.proposed),
      ),
      targets: own<PlanTarget>(await this.records.findMany("skp_target", {}, user)),
      skps: own<{ id: string; externalId?: string; startDate?: string; endDate?: string }>(
        await this.records.findMany("skp", {}, user),
      ),
    };
  }

  private async readRenaksiMonths(user: AuthUser, connector: RobotConnector, skp: { externalId?: string }) {
    let read: Awaited<ReturnType<RobotClient["ekinerjaRenaksiRead"]>>;
    try {
      read = await this.robot.ekinerjaRenaksiRead({ ...this.target(connector), skpExternalId: skp.externalId! });
    } catch (error) {
      await this.fail(user.id, connector, "sync", error);
      throw error;
    }
    await this.saveState(connector.id, read, false);
    if (!read.loggedIn) {
      await this.log(user.id, connector.id, "sync", read, { note: "Sesi kedaluwarsa — login ulang lalu coba lagi" });
      throw new BadRequestException("Sesi e-Kinerja kedaluwarsa. Login ulang di e-Kinerja → Connector.");
    }
    return read;
  }

  /** Bulan ke-n halaman Rencana Aksi SKP → periode YYYY-MM (tahun = tahun awal SKP). */
  private monthPeriod(skp: { startDate?: string }, month: number) {
    return `${(skp.startDate ?? "").slice(0, 4)}-${String(month).padStart(2, "0")}`;
  }

  private async saveMonth(
    user: AuthUser,
    skp: { id: string; externalId?: string; startDate?: string },
    month: number,
    data: Record<string, unknown>,
  ) {
    const period = this.monthPeriod(skp, month);
    const id = `apm-${skp.externalId}-${period}`;
    const existing = await this.records
      .findOne("action_plan_month", id, {}, user)
      .then((r) => r.payload)
      .catch(() => ({}));
    await this.records.upsert(
      "action_plan_month",
      id,
      {
        payload: {
          ...existing,
          ...data,
          id,
          period,
          skpId: skp.id,
          syncedAt: new Date().toISOString(),
        },
      },
      user,
    );
  }

  /** Isi entri saat terakhir dikirim (pembanding butir lama) + tanda tangannya. */
  private pushedFields(entry: PlanEntry) {
    const { targetId, description, realization, timeRealization, documentUrl, indicators } = entry;
    return {
      pushedSignature: entrySignature(entry),
      pushed: { targetId, description, realization, timeRealization, documentUrl, indicators },
    };
  }

  /**
   * Potret bulan → record `action_plan_month`; bulan draf: impor butir yang hanya ada di e-Kinerja; semua bulan berisi:
   * entri yang butirnya sudah ada ditandai terisi (atau diberi tanda tangan dasar bila terisi tanpa tanda tangan).
   * Mengembalikan jumlah entri yang diimpor.
   */
  private async applyRenaksiSnapshot(
    user: AuthUser,
    skp: { id: string; externalId?: string; startDate?: string },
    months: EkinerjaMonth[],
  ) {
    let imported = 0;
    const { entries, targets } = await this.renaksiData(user);
    // Usulan agen yang belum dicentang: dibuang bila isinya ternyata sudah ada di e-Kinerja (tidak tampil ganda)
    const proposals = (await this.records.findMany("action_plan_entry", {}, user))
      .filter((r) => !r.share && r.payload.proposed)
      .map((r) => r.payload as { id: string; period?: string; targetId?: string; description?: string });
    const importedNow: { period: string; targetId?: string; description: string }[] = [];
    const skpTargets = targets.filter((t) => t.skpId === skp.id);
    const now = new Date().toISOString();
    for (const m of months) {
      await this.saveMonth(user, skp, m.month, {
        status: m.status,
        submittedAt: m.submittedAt,
        workday: m.workday,
        ratings: m.ratings,
        rows: m.rows,
      });
      if (!m.rows.length) continue;
      const period = this.monthPeriod(skp, m.month);
      const own = entries.filter(
        (e) => e.period === period && (e.skpId ?? targets.find((t) => t.id === e.targetId)?.skpId) === skp.id,
      );
      if (m.status === "draft") {
        for (const c of importCandidates(m.rows, own, skpTargets)) {
          const id = `ap-ek-${createHash("sha256")
            .update(`${period}|${c.targetId}|${c.description}|${c.documentUrl}`)
            .digest("hex")
            .slice(0, 16)}`;
          const entry = { id, period, skpId: skp.id, ...c, status: "filled" } as PlanEntry;
          await this.records.upsert(
            "action_plan_entry",
            id,
            {
              payload: {
                ...entry,
                ...this.pushedFields(entry),
                sourceType: "ekinerja",
                sourceTitle: "Diisi langsung di e-Kinerja",
                filledAt: now,
                createdAt: now,
              },
            },
            user,
          );
          imported += 1;
          importedNow.push({ period, targetId: c.targetId, description: c.description });
        }
      }
      for (const entry of own) {
        if (entry.deleted || isChanged(entry)) continue;
        const target = targets.find((t) => t.id === entry.targetId);
        const present = entryPresent(entry, target, m.rows);
        const needsBaseline = entry.status === "filled" && !entry.pushedSignature;
        if ((entry.status !== "filled" && present) || (needsBaseline && present)) {
          await this.records.upsert(
            "action_plan_entry",
            entry.id,
            {
              payload: { ...entry, ...this.pushedFields(entry), status: "filled", filledAt: entry.filledAt ?? now },
            },
            user,
          );
        }
      }
    }
    for (const id of proposalsCoveredBy(proposals, importedNow)) {
      await this.records.remove("action_plan_entry", id, {}, user, { trash: false });
    }
    return imported;
  }

  /**
   * SRIKANDI: baca Daftar Naskah Keluar → record `srikandi_letter` per naskah; naskah yang sudah ditandatangani dan belum
   * punya berkas di Akasha diambil PDF-nya (maks. 5 per sinkron) dan disimpan sebagai berkas milik user (context
   * `srikandi`, ikut ekstraksi & indeks). Robot hanya membaca halaman — tidak ada tombol yang diklik di SRIKANDI.
   */
  syncSrikandiLetters(user: AuthUser, trigger: RobotJobTrigger = "button") {
    return this.job(user.id, "srikandi_letters", trigger, () => this.readSrikandiLetters(user));
  }

  private async readSrikandiLetters(user: AuthUser) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    const existing = await this.prisma.srikandiLetter.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { clientId: true, number: true, uploadId: true, extra: true },
    });
    const keyOf = (row: (typeof existing)[number]) =>
      ((row.extra as Record<string, unknown> | null)?.key as string | undefined) ?? row.number ?? "";
    const extraOf = (row: (typeof existing)[number]) => (row.extra as Record<string, unknown> | null) ?? {};
    // Lengkap = PDF utama + semua lampiran sudah di Akasha; yang baru punya PDF utama hanya diambil lampirannya
    const known = existing
      .filter((r) => r.uploadId && extraOf(r).attachmentsComplete === true)
      .map(keyOf)
      .filter(Boolean);
    const haveMain = existing
      .filter((r) => r.uploadId)
      .map(keyOf)
      .filter(Boolean);

    let result: Awaited<ReturnType<RobotClient["srikandiOutgoing"]>>;
    try {
      result = await this.robot.srikandiOutgoing({ ...this.target(connector), known, haveMain, maxFetch: 5 });
    } catch (error) {
      await this.fail(user.id, connector, "sync", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    if (!result.loggedIn) {
      await this.log(user.id, connector.id, "sync", result, { note: "Sesi kedaluwarsa — login ulang lalu coba lagi" });
      throw new BadRequestException("Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.");
    }

    const files = new Map(
      (result.files as FetchedLetter[]).filter((f) => typeof f?.key === "string").map((f) => [f.key, f]),
    );
    const letters = result.letters.map(cleanLetter).filter((l): l is NonNullable<typeof l> => !!l);
    let imported = 0;
    let attachmentCount = 0;
    const missed: { number: string; trace: string[] }[] = [];
    for (const letter of letters) {
      const id = letterClientId(letter.key);
      const current = existing.find((r) => r.clientId === id);
      const payload: Record<string, unknown> = {
        ...((current?.extra as Record<string, unknown> | null) ?? {}),
        id,
        ...letter,
        date: letter.date || undefined,
        ...(current?.uploadId ? { uploadId: current.uploadId } : {}),
        syncedAt: new Date().toISOString(),
      };
      const file = files.get(letter.key);
      if (file && !current?.uploadId) {
        const pdf = decodePdf(file.pdf);
        if (pdf) {
          const asset = await this.uploads.createFromBuffer(
            pdf,
            safePdfName(file.name),
            "application/pdf",
            user,
            "srikandi",
          );
          payload.uploadId = asset.id;
          payload.importedAt = new Date().toISOString();
          imported += 1;
        } else {
          missed.push({ number: letter.number, trace: (file.pages ?? []).slice(0, 5) });
        }
      }
      if (file && Array.isArray(file.attachments)) {
        const saved: LetterAttachment[] = [];
        const before = (extraOf(current ?? ({} as (typeof existing)[number])).attachments as LetterAttachment[]) ?? [];
        for (const raw of file.attachments.slice(0, 10)) {
          const meta = safeAttachment(raw?.name);
          if (!meta) continue;
          if (before.some((b) => b.name === meta.name && b.uploadId)) continue;
          const data = decodeAttachment(raw.data, meta.name);
          if (!data) {
            saved.push({ name: meta.name });
            continue;
          }
          const asset = await this.uploads.createFromBuffer(data, meta.name, meta.mimeType, user, "srikandi");
          saved.push({ name: meta.name, uploadId: asset.id });
          attachmentCount += 1;
        }
        const merged = mergeAttachments(before, saved);
        payload.attachments = merged;
        payload.attachmentsComplete = merged.every((a) => !!a.uploadId);
        if (!payload.attachmentsComplete) {
          missed.push({ number: `${letter.number} (lampiran)`, trace: (file.pages ?? []).slice(0, 5) });
        }
      }
      if (current) {
        const full = await this.records.findOne("srikandi_letter", id, {}, user);
        Object.assign(payload, { ...full.payload, ...payload });
      }
      await this.records.upsert("srikandi_letter", id, { payload }, user);
    }
    const signed = letters.filter((l) => /setuju|selesai|sudah/i.test(l.signStatus)).length;
    await this.log(user.id, connector.id, "sync", result, {
      note: `Naskah keluar: ${letters.length} terbaca, ${imported} PDF ber-TTD & ${attachmentCount} lampiran diambil${
        missed.length ? `, ${missed.length} PDF tidak tertangkap` : ""
      }`,
    });
    if (missed.length) this.logger.warn(`PDF SRIKANDI tidak tertangkap: ${JSON.stringify(missed)}`);
    const finalized = await this.finalizeSrikandiLetters(user);
    return {
      letters: letters.length,
      signed,
      imported,
      attachments: attachmentCount,
      missed: missed.map((m) => m.number),
      ...finalized,
    };
  }

  /**
   * SRIKANDI → Naskah Masuk: robot membaca daftar Naskah Masuk, Tembusan, Disposisi, Koordinasi, Arahan → record
   * `srikandi_inbox` (ID stabil dari isi). Detail naskah tidak dibuka (Status Baca di SRIKANDI tetap); isian tindak lanjut
   * Akasha pada record dipertahankan, dan butir yang tidak lagi tampil tidak dihapus.
   */
  syncSrikandiInbox(user: AuthUser, trigger: RobotJobTrigger = "button") {
    return this.job(user.id, "srikandi_inbox", trigger, () => this.readSrikandiInbox(user));
  }

  private async readSrikandiInbox(user: AuthUser) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    let result: Awaited<ReturnType<RobotClient["srikandiInbox"]>>;
    try {
      result = await this.robot.srikandiInbox({ ...this.target(connector) });
    } catch (error) {
      await this.fail(user.id, connector, "sync", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    if (!result.loggedIn) {
      await this.log(user.id, connector.id, "sync", result, { note: "Sesi kedaluwarsa — login ulang lalu coba lagi" });
      throw new BadRequestException("Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.");
    }
    const existing = new Map(
      (await this.records.findMany("srikandi_inbox", {}, user))
        .filter((r) => !r.share)
        .map((r) => [r.clientId, r.payload as Record<string, unknown>]),
    );
    const now = new Date().toISOString();
    const counts: Partial<Record<InboxKind, number>> = {};
    let added = 0;
    let updated = 0;
    const unread: string[] = [];
    for (const group of result.inbox) {
      const items = (Array.isArray(group.items) ? group.items : [])
        .map(cleanInboxItem)
        .filter((i): i is NonNullable<typeof i> => !!i);
      const kind = INBOX_KINDS.find((k) => k === group.kind);
      if (!kind) continue;
      counts[kind] = items.length;
      for (const item of items) {
        const id = inboxClientId(item);
        const merged = mergeInboxRecord(id, item, existing.get(id) ?? null, now);
        if (merged.isNew && isUnread(item.readStatus)) unread.push(id);
        if (!merged.changed) continue;
        await this.records.upsert("srikandi_inbox", id, { payload: merged.payload }, user);
        existing.set(id, merged.payload);
        if (merged.isNew) added += 1;
        else updated += 1;
      }
    }
    const summary = summarizeInboxSync(counts, added);
    await this.log(user.id, connector.id, "sync", result, { note: `Naskah masuk SRIKANDI: ${summary}` });
    const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
    return { counts, total, added, updated, newUnread: unread.length, summary };
  }

  /**
   * SRIKANDI: daftarkan satu entri Register Naskah Keluar (`srikandi_outgoing` milik user) lewat formulir Registrasi.
   * Robot berhenti di SIMPAN — draf masuk Log Naskah Keluar, Kirim Konsep tetap keputusan user. Draf berhal sama yang
   * belum terkirim dipakai ulang (tidak ganda). `dryRun` = isi formulir tanpa menyimpan, untuk diperiksa.
   */
  registerSrikandiOutgoing(user: AuthUser, entryId: string, dryRun = false) {
    return this.exclusive(user.id, "srikandi", "Daftarkan naskah", () =>
      this.writeSrikandiOutgoing(user, entryId, dryRun),
    );
  }

  private async writeSrikandiOutgoing(user: AuthUser, entryId: string, dryRun: boolean) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    const record = await this.records.findOne("srikandi_outgoing", entryId, {}, user);
    const entry = record.payload as unknown as OutgoingEntry & Record<string, unknown>;
    if (!dryRun && (entry.status === "submitted" || entry.status === "done")) {
      throw new BadRequestException("Entri ini sudah terdaftar di SRIKANDI.");
    }
    const blockers = registerBlockers(entry);
    if (blockers.length) throw new BadRequestException(`Isian belum lengkap: ${blockers.join(", ")}.`);

    const form = await this.outgoingForm(user, entry, true);

    let result: Awaited<ReturnType<RobotClient["srikandiRegister"]>>;
    try {
      result = await this.robot.srikandiRegister({ ...this.target(connector), form, dryRun });
    } catch (error) {
      await this.fail(user.id, connector, "register", error);
      throw error;
    }
    return this.finishRegister(user, connector, entryId, entry, result, dryRun);
  }

  /**
   * Isian formulir Registrasi dari entri Register + berkasnya dari object storage. `withMain` = sertakan file naskah
   * (Perbarui hanya mengirimnya bila diganti). Batas formulir SRIKANDI diperiksa sebelum berkas dibaca ke memori.
   */
  private async outgoingForm(user: AuthUser, entry: OutgoingEntry, withMain: boolean) {
    const references = (await this.records.findMany("srikandi_reference", {}, user))
      .filter((r) => !r.share)
      .map((r) => r.payload as unknown as { id: string; label: string; fields?: Record<string, string> });
    const sizes = await this.prisma.asset.findMany({
      where: { id: { in: [entry.file!, ...(entry.attachments ?? [])].map((f) => f.uploadId) } },
      select: { id: true, size: true },
    });
    const sizeOf = (id: string) => sizes.find((s) => s.id === id)?.size ?? 0;
    const sizeError = registerSizeError(
      sizeOf(entry.file!.uploadId),
      (entry.attachments ?? []).map((a) => sizeOf(a.uploadId)),
    );
    if (sizeError) throw new BadRequestException(sizeError);
    const loadFile = async (file: { uploadId: string; name: string }, attachment: boolean) => {
      const { asset } = await this.uploads.findWithPermission(file.uploadId, user);
      const buffer = await this.storage.getObjectBuffer(asset.objectKey);
      return {
        name: attachment ? cleanAttachmentName(file.name) : file.name,
        mimeType: asset.mimeType,
        data: buffer.toString("base64"),
      };
    };
    return {
      ...buildRegisterFields(entry, references),
      ...(withMain ? { file: await loadFile(entry.file!, false) } : {}),
      attachments: await Promise.all((entry.attachments ?? []).map((a) => loadFile(a, true))),
    };
  }

  /** Simpan tangkapan layar run robot SRIKANDI ke object storage (Riwayat Connector). */
  private async saveRunScreenshot(userId: string, runId: string, screenshot: string | null) {
    if (!screenshot) return;
    const image = Buffer.from(screenshot, "base64");
    const key = `robot/${userId}/${runId}.jpg`;
    await this.storage.putObject({
      key,
      body: image,
      contentLength: image.length,
      contentType: "image/jpeg",
      checksum: createHash("sha256").update(image).digest("hex"),
    });
    await this.prisma.robotRun.update({ where: { id: runId }, data: { screenshotKey: key } });
  }

  private async finishRegister(
    user: AuthUser,
    connector: Awaited<ReturnType<RobotService["connector"]>>,
    entryId: string,
    entry: OutgoingEntry & Record<string, unknown>,
    result: Awaited<ReturnType<RobotClient["srikandiRegister"]>>,
    dryRun: boolean,
  ) {
    await this.saveState(connector.id, result, false);
    if (result.status === "logged_out") {
      await this.log(user.id, connector.id, "register", result, {
        note: "Sesi kedaluwarsa — login ulang lalu coba lagi",
      });
      throw new BadRequestException("Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.");
    }
    const subject = entry.subject?.trim() ?? "";
    const note =
      result.status === "preview"
        ? `Register (periksa, tidak disimpan): ${subject}`
        : result.status === "exists"
          ? `Register: draf berhal sama sudah ada di Log Naskah Keluar — ${subject}`
          : `Register: draf disimpan di Log Naskah Keluar (belum dikirim) — ${subject}`;
    const run = await this.log(user.id, connector.id, "register", result, { note });
    await this.saveRunScreenshot(user.id, run.id, result.screenshot);
    if (!dryRun) {
      await this.records.upsert(
        "srikandi_outgoing",
        entryId,
        {
          payload: {
            ...entry,
            status: "submitted",
            submittedAt: new Date().toISOString(),
            srikandiDraftId: result.draft?.detailId ?? undefined,
            srikandiNumber: result.draft?.number ?? undefined,
            pushedSubject: entry.subject?.trim(),
            pushedSignature: outgoingSignature(entry),
            pushedFileId: entry.file?.uploadId,
          },
        },
        user,
      );
    }
    return { status: result.status, filled: result.filled, draft: result.draft, runId: run.id };
  }

  /**
   * SRIKANDI: perbarui konsep entri yang sudah terdaftar lewat Edit di Log Naskah Keluar. Hanya isian yang berbeda yang
   * diubah robot; file naskah dikirim hanya bila diganti. Konsep yang sudah dikirim (tanpa tautan Edit) ditolak.
   * Berhasil → pengenal perubahan entri diperbarui. `dryRun` = rencana tanpa klik.
   */
  updateSrikandiOutgoing(user: AuthUser, entryId: string, dryRun = false) {
    return this.exclusive(user.id, "srikandi", "Perbarui naskah", () =>
      this.editSrikandiOutgoing(user, entryId, dryRun),
    );
  }

  private async editSrikandiOutgoing(user: AuthUser, entryId: string, dryRun: boolean) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    const record = await this.records.findOne("srikandi_outgoing", entryId, {}, user);
    const entry = record.payload as unknown as OutgoingEntry & Record<string, unknown>;
    if (entry.status !== "submitted") {
      throw new BadRequestException("Hanya entri yang sudah terdaftar (konsep di SRIKANDI) yang bisa diperbarui.");
    }
    if (entry.draftSentAt) {
      throw new BadRequestException("Konsep ini sudah dikirim ke verifikator sehingga tidak bisa diubah lewat Edit.");
    }
    const blockers = registerBlockers(entry);
    if (blockers.length) throw new BadRequestException(`Isian belum lengkap: ${blockers.join(", ")}.`);
    const replaceFile = !!entry.pushedFileId && entry.file?.uploadId !== entry.pushedFileId;
    const form = {
      ...(await this.outgoingForm(user, entry, replaceFile)),
      findSubject: (entry.pushedSubject || entry.subject || "").trim(),
    };

    let result: Awaited<ReturnType<RobotClient["srikandiRegisterUpdate"]>>;
    try {
      result = await this.robot.srikandiRegisterUpdate({ ...this.target(connector), form, dryRun });
    } catch (error) {
      await this.fail(user.id, connector, "register", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    const subject = entry.subject?.trim() ?? "";
    const messages: Record<typeof result.status, string> = {
      logged_out: "Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.",
      not_found: `Konsep "${form.findSubject}" tidak ditemukan di Log Naskah Keluar (mungkin dihapus atau halnya diubah langsung di SRIKANDI).`,
      locked: "Konsep ini sudah dikirim / diproses di SRIKANDI sehingga tidak bisa diubah lewat Edit.",
      preview: `Perbarui (periksa, tidak disimpan): ${subject}`,
      unchanged: `Perbarui: konsep di SRIKANDI sudah sama — ${subject}`,
      updated: `Perbarui: konsep diubah di Log Naskah Keluar (belum dikirim) — ${subject}`,
    };
    const run = await this.log(user.id, connector.id, "register", result, {
      note: [messages[result.status], ...result.plan].join(" · ").slice(0, 1_000),
    });
    await this.saveRunScreenshot(user.id, run.id, result.screenshot);
    if (result.status === "logged_out" || result.status === "not_found" || result.status === "locked") {
      throw new BadRequestException(messages[result.status]);
    }
    if (result.status === "updated" || result.status === "unchanged") {
      await this.records.upsert(
        "srikandi_outgoing",
        entryId,
        {
          payload: {
            ...entry,
            pushedSubject: subject,
            pushedSignature: outgoingSignature(entry),
            pushedFileId: entry.file?.uploadId,
            updatedInSrikandiAt: result.status === "updated" ? new Date().toISOString() : entry.updatedInSrikandiAt,
          },
        },
        user,
      );
    }
    return {
      status: result.status,
      plan: result.plan,
      warnings: result.warnings,
      remaining: result.remaining ?? [],
      runId: run.id,
    };
  }

  /**
   * SRIKANDI: **Kirim Konsep** entri Register yang sudah terdaftar (konsep di Log Naskah Keluar → verifikator). Hanya pemilik
   * dari aplikasi Akasha yang bisa mengirim, dan setiap kali wajib PIN keamanan (`PinService.confirmAction`; token agen /
   * MCP selalu ditolak). `dryRun` (bawaan) = robot membuka halaman detail konsep dan menandai tombol Kirim Konsep tanpa
   * mengklik — tanpa PIN. Tidak ada jalur agen, kebijakan otomatis, atau jadwal yang memanggil ini.
   */
  sendSrikandiOutgoing(user: AuthUser, entryId: string, options: { dryRun?: boolean; pin?: string }) {
    return this.exclusive(user.id, "srikandi", "Kirim Konsep", () =>
      this.sendSrikandiDraft(user, entryId, options.dryRun !== false, options.pin),
    );
  }

  private async sendSrikandiDraft(user: AuthUser, entryId: string, dryRun: boolean, pin: string | undefined) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    const record = await this.records.findOne("srikandi_outgoing", entryId, {}, user);
    if (record.share) throw new ForbiddenException("Hanya pemilik entri yang bisa Kirim Konsep.");
    const entry = record.payload as unknown as OutgoingEntry & Record<string, unknown>;
    const blockers = sendBlockers(entry);
    if (blockers.length) throw new BadRequestException(blockers.join(" "));
    // PIN diperiksa sebelum robot dipanggil: salah PIN tidak pernah sampai ke SRIKANDI
    if (!dryRun) await this.pins.confirmAction(user, pin);

    const subject = entry.subject?.trim() ?? "";
    let result: Awaited<ReturnType<RobotClient["srikandiSendDraft"]>>;
    try {
      result = await this.robot.srikandiSendDraft({
        ...this.target(connector),
        subject,
        findSubject: (entry.pushedSubject || subject).trim(),
        number: typeof entry.srikandiNumber === "string" ? entry.srikandiNumber : "",
        dryRun,
        ...(dryRun ? {} : { confirm: "KIRIM_KONSEP" as const }),
      });
    } catch (error) {
      await this.fail(user.id, connector, "register", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    const messages: Record<typeof result.status, string> = {
      logged_out: "Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.",
      not_found: `Konsep "${subject}" tidak ditemukan di Log Naskah Keluar.`,
      already_sent:
        "Konsep ini sudah tidak berstatus belum dikirim di SRIKANDI (mungkin sudah dikirim langsung di SRIKANDI).",
      mismatch:
        "Halaman detail SRIKANDI tidak cocok dengan entri ini (hal / nomor berbeda) — robot berhenti tanpa mengirim.",
      not_ready: "Tombol Kirim Konsep di SRIKANDI belum aktif (periksa isian konsep di SRIKANDI).",
      ready: `Kirim Konsep (periksa, tidak dikirim): tombol Kirim Konsep ditemukan — ${subject}`,
      unconfirmed: `SRIKANDI menampilkan dialog yang tidak dikenali robot, jadi dibatalkan tanpa mengirim: ${result.message}`,
      failed: `SRIKANDI menolak Kirim Konsep: ${result.message}`,
      unknown: `Kirim Konsep diklik tetapi hasilnya belum pasti — periksa Log Naskah Keluar di SRIKANDI. ${result.message}`,
      sent: `Kirim Konsep: konsep dikirim ke verifikator — ${subject}`,
    };
    const run = await this.log(user.id, connector.id, "register", result, {
      note: messages[result.status].slice(0, 1_000),
    });
    await this.saveRunScreenshot(user.id, run.id, result.screenshot);
    if (result.status !== "ready" && result.status !== "sent") {
      throw new BadRequestException(messages[result.status]);
    }
    if (result.status === "sent") {
      await this.records.upsert(
        "srikandi_outgoing",
        entryId,
        { payload: { ...entry, draftSentAt: new Date().toISOString() } },
        user,
      );
    }
    return { status: result.status, message: messages[result.status], runId: run.id };
  }

  /**
   * SRIKANDI → Pengguna: ambil referensi (penandatangan, tujuan, verifikator, tembusan, grup) → record
   * `srikandi_reference` milik user, bahan pilihan Register Naskah Keluar. Robot hanya membaca tabel.
   */
  /** `classification` saja = tugas "Ambil klasifikasi arsip"; selain itu "Ambil referensi". */
  syncSrikandiReferences(user: AuthUser, categories?: string[], trigger: RobotJobTrigger = "button") {
    const kind =
      categories?.length === 1 && categories[0] === "classification"
        ? "srikandi_classifications"
        : "srikandi_references";
    return this.job(user.id, kind, trigger, () => this.readSrikandiReferences(user, categories));
  }

  private async readSrikandiReferences(user: AuthUser, categories?: string[]) {
    const connector = await this.connector(user.id, "srikandi");
    this.requireSession(connector);
    let result: Awaited<ReturnType<RobotClient["srikandiReferences"]>>;
    try {
      result = await this.robot.srikandiReferences({ ...this.target(connector), categories });
    } catch (error) {
      await this.fail(user.id, connector, "sync", error);
      throw error;
    }
    await this.saveState(connector.id, result, false);
    if (!result.loggedIn) {
      await this.log(user.id, connector.id, "sync", result, { note: "Sesi kedaluwarsa — login ulang lalu coba lagi" });
      throw new BadRequestException("Sesi SRIKANDI kedaluwarsa. Login ulang di SRIKANDI → Connector.");
    }
    const syncedAt = new Date().toISOString();
    const counts: Record<string, number> = {};
    const pages: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const group of result.references) {
      const items = (Array.isArray(group.items) ? group.items : [])
        .map(cleanReference)
        .filter((r): r is NonNullable<typeof r> => !!r);
      const category = items[0]?.category ?? REFERENCE_CATEGORIES.find((c) => c === group.category);
      if (!category) continue;
      const ids: string[] = [];
      for (const [index, item] of items.entries()) {
        const id = referenceClientId(item);
        if (ids.includes(id)) continue;
        ids.push(id);
        await this.records.upsert(
          "srikandi_reference",
          id,
          { payload: { id, ...item, order: index + 1, syncedAt } },
          user,
        );
      }
      const existing = await this.prisma.srikandiReference.findMany({
        where: { userId: user.id, category, deletedAt: null },
        select: { clientId: true },
      });
      for (const id of staleReferences(
        existing.map((e) => e.clientId),
        ids,
      ))
        await this.records.remove("srikandi_reference", id, {}, user, { trash: false });
      counts[category] = ids.length;
      pages[category] = group.pages ?? 1;
      if (typeof group.total === "number") totals[category] = group.total;
      if (typeof group.total !== "number" || ids.length < group.total) {
        this.logger.warn(
          `Referensi SRIKANDI ${category}: ${ids.length} dari ${group.total}; navigasi: ${group.nav ?? ""}`,
        );
      }
    }
    await this.log(user.id, connector.id, "sync", result, {
      note: `Referensi SRIKANDI: ${Object.entries(counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    });
    return { counts, totals, pages };
  }

  /**
   * Naskah ber-TTD + lampirannya → Resource Global (tag "Dokumen Final") dan File Control (Gantung), sekali per berkas
   * (resource yang sudah dihapus user tidak dibuat ulang). Tautan ke dokumen mentah yang dikirim ke SRIKANDI dibuat lewat
   * Register Naskah Keluar (gerbang dari Approval / Working Space), bukan ditebak dari isi dokumen.
   */
  private async finalizeSrikandiLetters(user: AuthUser) {
    const rows = await this.prisma.srikandiLetter.findMany({
      where: { userId: user.id, deletedAt: null, uploadId: { not: null } },
      select: { clientId: true },
    });
    let resources = 0;
    for (const row of rows) {
      const record = await this.records.findOne("srikandi_letter", row.clientId, {}, user);
      const letter = record.payload as Record<string, unknown>;
      const number = String(letter.number ?? "");
      const subject = String(letter.subject ?? "");
      const uploadId = String(letter.uploadId);
      const created = { ...((letter.resources as Record<string, string> | undefined) ?? {}) };
      const files = [
        { uploadId, title: `${number || "Naskah"} — ${subject}`.slice(0, 300), main: true },
        ...((letter.attachments as LetterAttachment[] | undefined) ?? [])
          .filter((a) => a.uploadId)
          .map((a) => ({ uploadId: a.uploadId!, title: `Lampiran ${number}: ${a.name}`.slice(0, 300), main: false })),
      ];
      let changed = false;
      for (const file of files) {
        if (created[file.uploadId]) continue;
        const asset = await this.prisma.asset.findFirst({
          where: { id: file.uploadId, userId: user.id },
          select: { mimeType: true },
        });
        if (!asset) continue;
        const id = letterResourceId(file.uploadId);
        const now = new Date().toISOString();
        await this.records.upsert(
          "para_resource",
          id,
          {
            payload: {
              id,
              title: file.title,
              type: "file",
              uploadId: file.uploadId,
              mimeType: asset.mimeType,
              date: (letter.date as string | undefined) ?? now.slice(0, 10),
              createdAt: now,
              tags: [FINAL_CONTEXT_TAG],
              content: file.main
                ? `Naskah keluar SRIKANDI ${number} (${String(letter.dateText ?? "")}), ditandatangani elektronik.`
                : `Lampiran naskah keluar SRIKANDI ${number}.`,
              archivalStatus: "pending",
            },
          },
          user,
        );
        created[file.uploadId] = id;
        resources += 1;
        changed = true;
      }
      if (changed) letter.resources = created;

      if (changed) await this.records.upsert("srikandi_letter", row.clientId, { payload: letter }, user);
    }
    return { resources };
  }

  // ---------------------------------------------------------------- Log run

  async runs(userId: string, system?: string) {
    const rows = await this.prisma.robotRun.findMany({
      where: { userId, ...(system ? { connector: { system } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: RUN_SELECT,
    });
    return rows.map((r) => this.runView(r));
  }

  async run(userId: string, id: string) {
    const row = await this.prisma.robotRun.findFirst({ where: { id, userId }, select: { ...RUN_SELECT, aria: true } });
    if (!row) throw new NotFoundException("Rekaman robot tidak ditemukan.");
    return { ...this.runView(row), aria: row.aria };
  }

  async screenshot(userId: string, id: string) {
    const row = await this.prisma.robotRun.findFirst({ where: { id, userId }, select: { screenshotKey: true } });
    if (!row?.screenshotKey) throw new NotFoundException("Tangkapan layar tidak ada.");
    return this.storage.getObject(row.screenshotKey);
  }

  async removeRun(userId: string, id: string) {
    const row = await this.prisma.robotRun.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Rekaman robot tidak ditemukan.");
    await this.prisma.robotRun.delete({ where: { id } });
    if (row.screenshotKey) await this.storage.deleteObject(row.screenshotKey).catch(() => undefined);
    return { success: true };
  }

  // ---------------------------------------------------------------- Bantuan

  private async connector(userId: string, system: string) {
    if (!isRobotSystem(system)) throw new NotFoundException("Sistem tidak dikenal.");
    await this.connectors(userId);
    return this.prisma.robotConnector.findUniqueOrThrow({ where: { userId_system: { userId, system } } });
  }

  private login(userId: string, sessionId: string) {
    const live = this.logins.get(sessionId);
    if (!live) throw new NotFoundException("Sesi login tidak ditemukan atau sudah ditutup.");
    if (live.userId !== userId) throw new ForbiddenException("Bukan sesi login Anda.");
    return live;
  }

  private requireUrl(connector: RobotConnector) {
    if (!connector.baseUrl) throw new BadRequestException("Isi alamat sistem dulu.");
  }

  private requireSession(connector: RobotConnector) {
    this.requireUrl(connector);
    if (!connector.sessionEnc) throw new BadRequestException("Belum ada sesi. Login dulu lewat browser jarak jauh.");
  }

  private target(connector: RobotConnector): RobotTarget {
    let storageState: StorageState | null = null;
    if (connector.sessionEnc) {
      try {
        storageState = JSON.parse(this.crypto.decrypt(connector.sessionEnc)) as StorageState;
      } catch {
        this.logger.warn(`Sesi robot ${connector.id} tidak dapat dibaca (kunci berubah?) — diabaikan.`);
      }
    }
    return {
      baseUrl: connector.baseUrl,
      extraHosts: connectorHosts(connector.system, asList(connector.extraHosts)),
      loginMarkers: [...SYSTEM_INFO[connector.system as RobotSystem].loginMarkers, ...asList(connector.loginMarkers)],
      storageState,
    };
  }

  /** Simpan sesi terbaru (cookie bisa diperbarui server) + status dari hasil robot. */
  private saveState(connectorId: string, result: PageInfo & { storageState: StorageState }, login: boolean) {
    const now = new Date();
    return this.prisma.robotConnector.update({
      where: { id: connectorId },
      data: {
        // Login gagal tidak menimpa sesi lama yang mungkin masih berguna
        ...(result.loggedIn || !login ? { sessionEnc: this.crypto.encrypt(JSON.stringify(result.storageState)) } : {}),
        status: result.loggedIn ? "active" : login ? "none" : "expired",
        lastCheckAt: now,
        ...(login && result.loggedIn ? { lastLoginAt: now } : {}),
        lastUrl: result.url,
        lastError: null,
      },
    });
  }

  private log(
    userId: string,
    connectorId: string,
    kind: string,
    result: PageInfo,
    extra: { note?: string; aria?: string } = {},
  ) {
    return this.prisma.robotRun.create({
      data: {
        userId,
        connectorId,
        kind,
        status: result.loggedIn ? "ok" : "failed",
        url: result.url,
        title: result.title.slice(0, 300),
        note: extra.note ?? null,
        aria: extra.aria ?? null,
      },
    });
  }

  private async fail(userId: string, connector: RobotConnector, kind: string, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await this.prisma.robotConnector.update({ where: { id: connector.id }, data: { lastError: message } });
    await this.prisma.robotRun.create({
      data: { userId, connectorId: connector.id, kind, status: "failed", error: message },
    });
  }

  private view(row: RobotConnector) {
    const system = row.system as RobotSystem;
    return {
      system,
      ...SYSTEM_INFO[system],
      baseUrl: row.baseUrl,
      extraHosts: asList(row.extraHosts),
      loginMarkers: asList(row.loginMarkers),
      status: row.status,
      hasSession: !!row.sessionEnc,
      hasCredentials: !!row.passwordEnc,
      credentialHint: row.credentialHint,
      credentialsUpdatedAt: row.credentialsUpdatedAt,
      lastLoginAt: row.lastLoginAt,
      lastCheckAt: row.lastCheckAt,
      lastUrl: row.lastUrl,
      lastError: row.lastError,
    };
  }

  private runView(row: Prisma.RobotRunGetPayload<{ select: typeof RUN_SELECT }>) {
    const { screenshotKey, connector, ...rest } = row;
    return { ...rest, system: connector.system, hasScreenshot: !!screenshotKey };
  }
}
