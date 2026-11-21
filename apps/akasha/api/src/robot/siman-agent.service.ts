import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import { SYSTEM_INFO } from "./robot-logic";
import { PrismaService } from "../prisma/prisma.service";
import { RobotService } from "./robot.service";
import {
  SIMAN_FILE_CHARS,
  SIMAN_TASK_LABELS,
  type SimanAgentTask,
  simanPageUrl,
  simanTicketNumber,
  summarizePage,
  summarizeSimanTask,
} from "./siman-agent-logic";

interface AgentTask {
  id: string;
  task: SimanAgentTask;
  label: string;
  /** Alamat halaman (page) atau "" */
  target: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  /** Isi halaman untuk agen (hanya "page") */
  result: unknown;
}

const KEEP_PER_USER = 10;

/**
 * Robot SIMAN yang dijalankan agen lewat MCP — pola sama dengan `SrikandiAgentService`: tugas dimulai di latar belakang
 * (bisa melebihi batas waktu MCP Hermes 180 dtk) dan dibaca lewat `siman_status`. Riwayat tugas di memori satu proses;
 * rekaman halaman tetap tersimpan di riwayat koneksi (`robot_runs`). Hanya tugas yang **membaca** SIMAN.
 */
@Injectable()
export class SimanAgentService {
  private readonly logger = new Logger(SimanAgentService.name);
  private readonly tasks = new Map<string, AgentTask[]>();

  constructor(
    private readonly robot: RobotService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Isi teks berkas kelengkapan tiket (berkas konteks `siman` milik pemilik) hasil ekstraksi / Markdown Converter. Masih
   * dibaca = agen diminta menunggu. Hanya berkas yang diambil robot tiket SIMAN yang bisa dibaca lewat alat ini.
   */
  async readFile(user: AuthUser, uploadId: string, offset = 0) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: uploadId, userId: user.id, context: "siman" },
      select: { id: true, originalName: true, mimeType: true, size: true, extraction: true },
    });
    if (!asset) throw new BadRequestException("Berkas tidak ditemukan (hanya berkas kelengkapan tiket SIMAN).");
    const ex = asset.extraction;
    if (!ex || ex.status === "pending" || ex.status === "extracting")
      return { nama: asset.originalName, status: "masih dibaca", catatan: "Tunggu ± 1 menit lalu panggil lagi." };
    const text = ex.extractedText ?? "";
    const start = Math.max(0, offset);
    return {
      nama: asset.originalName,
      jenis: asset.mimeType,
      status: ex.status,
      ...(ex.error ? { galat: ex.error } : {}),
      panjang: text.length,
      mulai: start,
      isi: text.slice(start, start + SIMAN_FILE_CHARS),
      ...(start + SIMAN_FILE_CHARS < text.length ? { lanjut: start + SIMAN_FILE_CHARS } : {}),
    };
  }

  start(user: AuthUser, task: SimanAgentTask, url?: string, options: { source?: "penetapan" | "permohonan" } = {}) {
    let target = "";
    if (task === "ticket") {
      const ticket = simanTicketNumber(url);
      if (!ticket) throw new BadRequestException("Nomor tiket tidak valid (PPL…).");
      target = ticket;
    }
    if (task === "page") {
      const checked = simanPageUrl(url, SYSTEM_INFO.siman.homeUrl ?? SYSTEM_INFO.siman.defaultUrl);
      if ("error" in checked) throw new BadRequestException(checked.error);
      target = checked.url;
    }
    const list = this.tasks.get(user.id) ?? [];
    const running = list.find((t) => t.status === "running");
    if (running) {
      throw new BadRequestException(
        `Robot SIMAN masih menjalankan "${running.label}". Tunggu sampai selesai — cek siman_status.`,
      );
    }
    const item: AgentTask = {
      id: randomUUID(),
      task,
      label: SIMAN_TASK_LABELS[task],
      target,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: null,
      error: null,
      result: null,
    };
    this.tasks.set(user.id, [item, ...list].slice(0, KEEP_PER_USER));
    void this.execute(user, item, options);
    return item;
  }

  private async execute(user: AuthUser, item: AgentTask, options: { source?: "penetapan" | "permohonan" } = {}) {
    try {
      let result: unknown;
      if (item.task === "session") result = await this.robot.check(user.id, "siman", "agent");
      else if (item.task === "requests") result = await this.robot.syncSimanRequests(user, "agent");
      else if (item.task === "ticket") {
        result = await this.robot.readSimanTicket(user, item.target, { source: options.source });
        item.result = result;
      } else {
        const run = await this.robot.readSimanPage(user.id, item.target);
        result = run;
        item.result = summarizePage(run);
      }
      item.summary = summarizeSimanTask(item.task, result);
      item.status = "done";
    } catch (error) {
      item.status = "failed";
      item.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      this.logger.warn(`Tugas agen SIMAN "${item.label}" gagal: ${item.error}`);
    } finally {
      item.finishedAt = new Date().toISOString();
    }
  }

  /** Hasil lengkap tiket yang terakhir dibaca (aset, kelengkapan, riwayat) — tidak ikut di status agar ringkas. */
  ticketResult(user: AuthUser, ticket: string) {
    const number = simanTicketNumber(ticket);
    const found = (this.tasks.get(user.id) ?? []).find(
      (t) => t.task === "ticket" && t.target === number && t.status === "done",
    );
    if (!found)
      throw new BadRequestException("Tiket itu belum dibaca. Jalankan siman_read_ticket lalu tunggu selesai.");
    return found.result;
  }

  /** Status sesi konektor + tugas agen terakhir (terbaru dulu). */
  async status(user: AuthUser) {
    const connector = (await this.robot.connectors(user.id)).find((c) => c.system === "siman");
    return {
      sesi: !connector?.hasSession
        ? "belum login — pemilik perlu login di SIMAN → Connector"
        : connector.status === "expired"
          ? "kedaluwarsa — pemilik perlu login ulang di SIMAN → Connector"
          : "tersimpan",
      alamat: connector?.baseUrl ?? SYSTEM_INFO.siman.defaultUrl,
      pemeriksaan_sesi_terakhir: connector?.lastCheckAt ?? null,
      galat_terakhir: connector?.lastError ?? null,
      // Hasil tiket bisa ribuan aset → di status hanya ringkasan; isi lengkap lewat siman_ticket_result
      tugas: (this.tasks.get(user.id) ?? []).map((t) => (t.task === "ticket" ? { ...t, result: undefined } : t)),
    };
  }
}
