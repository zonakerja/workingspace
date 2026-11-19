import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { AkaiError, AkaiService, type AkaiTranscribeJob } from "../../akai/akai.service";
import { AuthUser } from "../../common/types/auth-user";
import { PrismaService } from "../../prisma/prisma.service";
import { ObjectStorageService } from "../../storage/object-storage.service";
import { UploadsService } from "../../uploads/uploads.service";

interface TranscribeResult {
  text: string;
  truncated: boolean;
  passes: number;
  /** Kelengkapan yang perlu diperiksa user (bagian gagal / terpotong). */
  warning: string | null;
  provider: string;
  model: string;
}

export type TranscribeJob =
  | { status: "running"; startedAt: number }
  | { status: "done"; startedAt: number; finishedAt: number; result: TranscribeResult }
  | { status: "failed"; startedAt: number; finishedAt: number; httpStatus: number; message: string };

/** Hasil disimpan sementara agar bisa diambil setelah tab ditutup / dibuka lagi tanpa membayar transkrip kedua. */
const RESULT_TTL_MS = 24 * 60 * 60_000;
const POLL_MS = 5_000;
/** Rekaman sangat panjang tetap selesai dalam batas ini (Akai mengerjakan potongan 3 paralel). */
const JOB_LIMIT_MS = 3 * 60 * 60_000;

/**
 * Transkrip berkas audio tersimpan lewat Akai (tugas Transkrip di Akai → Model, Gemini langsung): audio dialirkan dari
 * object storage ke Akai, lalu statusnya dipantau di latar belakang. Status di memori satu proses backend (restart =
 * pekerjaan hilang, user bisa memulai lagi; potongan yang sudah berhasil di Akai tidak dibayar dua kali). Satu berkas per
 * user hanya dikerjakan sekali.
 */
@Injectable()
export class TranscribeService {
  private readonly logger = new Logger(TranscribeService.name);
  private readonly jobs = new Map<string, TranscribeJob>();

  constructor(
    private readonly akai: AkaiService,
    private readonly uploads: UploadsService,
    private readonly storage: ObjectStorageService,
    private readonly prisma: PrismaService,
  ) {}

  /** Mulai transkrip; bila sedang berjalan atau sudah selesai, pekerjaan yang ada dikembalikan. */
  async start(user: AuthUser, uploadId: string): Promise<TranscribeJob> {
    this.prune();
    const { asset } = await this.uploads.findWithPermission(uploadId, user);
    const mimeType = asset.mimeType.split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith("audio/")) throw new BadRequestException("Berkas ini bukan audio.");

    const key = this.key(user.id, uploadId);
    const existing = this.jobs.get(key);
    // Selesai tetapi ada bagian gagal/terpotong = boleh diulang; bagian yang sudah berhasil tidak dibayar lagi
    if (existing?.status === "running" || (existing?.status === "done" && !existing.result.truncated)) return existing;

    const job: TranscribeJob = { status: "running", startedAt: Date.now() };
    this.jobs.set(key, job);
    void this.run(key, user.id, asset.id, asset.objectKey, Number(asset.size), mimeType, job.startedAt);
    return job;
  }

  /** Hanya pekerjaan milik user sendiri (kunci memuat ID user). */
  status(userId: string, uploadId: string): TranscribeJob | null {
    this.prune();
    return this.jobs.get(this.key(userId, uploadId)) ?? null;
  }

  private key(userId: string, uploadId: string) {
    return `${userId}:${uploadId}`;
  }

  private prune() {
    const now = Date.now();
    for (const [key, job] of this.jobs) {
      if (job.status !== "running" && now - job.finishedAt > RESULT_TTL_MS) this.jobs.delete(key);
    }
  }

  private fail(key: string, startedAt: number, httpStatus: number, message: string) {
    this.jobs.set(key, { status: "failed", startedAt, finishedAt: Date.now(), httpStatus, message });
  }

  private async run(
    key: string,
    userId: string,
    assetId: string,
    objectKey: string,
    sizeBytes: number,
    mimeType: string,
    startedAt: number,
  ) {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { ssoSubject: true, email: true, name: true },
      });
      let remote: AkaiTranscribeJob | null = await this.akai.transcribeStart(
        user,
        assetId,
        mimeType,
        await this.storage.getObject(objectKey),
        sizeBytes,
      );
      while (remote?.status === "running") {
        if (Date.now() - startedAt > JOB_LIMIT_MS) return this.fail(key, startedAt, 422, "Transkrip terlalu lama.");
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        remote = await this.akai.transcribeStatus(user, assetId);
      }
      if (!remote) return this.fail(key, startedAt, 422, "Akai dimulai ulang di tengah transkrip. Coba lagi.");
      if (remote.status === "failed") return this.fail(key, startedAt, remote.httpStatus, remote.message);
      this.jobs.set(key, { status: "done", startedAt, finishedAt: Date.now(), result: remote.result });
      this.logger.log(
        `Transkrip ${assetId} selesai: ${remote.result.text.length} karakter, ${remote.result.passes} bagian, ${Date.now() - startedAt} ms`,
      );
    } catch (error) {
      const message =
        error instanceof AkaiError ? error.message : "Transkrip gagal karena kesalahan server. Coba lagi.";
      this.fail(key, startedAt, error instanceof AkaiError && error.status === 429 ? 429 : 422, message);
      this.logger.warn(`Transkrip ${assetId} gagal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
