import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import {
  EKINERJA_TASK_LABELS,
  type EkinerjaAgentTask,
  isPeriod,
  isYear,
  summarizeCheck,
  summarizeTask,
} from "./ekinerja-agent-logic";
import { RobotService } from "./robot.service";

interface AgentTask {
  id: string;
  task: EkinerjaAgentTask;
  label: string;
  /** Tahun (skp, monitor) atau bulan YYYY-MM (check) */
  target: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  /** Hasil ringkas untuk agen (hanya "check": baris yang terbaca & rencana langkah) */
  result: unknown;
}

const KEEP_PER_USER = 10;

/**
 * Robot e-Kinerja yang dijalankan agen lewat MCP. Tugas robot bisa lebih lama dari batas waktu MCP Hermes (180 dtk),
 * jadi tugas dimulai di latar belakang dan agen membaca hasilnya lewat `ekinerja_status`. Riwayat tugas ada di memori
 * satu proses (hilang saat backend restart); hasil Ambil SKP & Pantau tetap tersimpan sebagai record dan di riwayat
 * Otomasi (pemicu "agent"). Hanya tugas yang **membaca** e-Kinerja; pengisian lewat permintaan yang disetujui pemilik.
 */
@Injectable()
export class EkinerjaAgentService {
  private readonly logger = new Logger(EkinerjaAgentService.name);
  private readonly tasks = new Map<string, AgentTask[]>();

  constructor(private readonly robot: RobotService) {}

  start(user: AuthUser, task: EkinerjaAgentTask, target: number | string) {
    if (task === "check" ? !isPeriod(target) : !isYear(target)) {
      throw new BadRequestException(task === "check" ? "Bulan harus YYYY-MM." : "Tahun tidak valid.");
    }
    const list = this.tasks.get(user.id) ?? [];
    const running = list.find((t) => t.status === "running");
    if (running) {
      throw new BadRequestException(
        `Robot e-Kinerja masih menjalankan "${running.label}" (${running.target}). Tunggu sampai selesai — cek ekinerja_status.`,
      );
    }
    const item: AgentTask = {
      id: randomUUID(),
      task,
      label: EKINERJA_TASK_LABELS[task],
      target: String(target),
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: null,
      error: null,
      result: null,
    };
    this.tasks.set(user.id, [item, ...list].slice(0, KEEP_PER_USER));
    void this.execute(user, item, target);
    return item;
  }

  private async execute(user: AuthUser, item: AgentTask, target: number | string) {
    try {
      let result: unknown;
      if (item.task === "skp") result = await this.robot.syncEkinerjaSkp(user, target as number, "agent");
      else if (item.task === "monitor") result = await this.robot.syncEkinerjaRenaksi(user, target as number, "agent");
      else {
        const check = await this.robot.fillEkinerjaRenaksi(user, target as string, true);
        result = check;
        item.result = summarizeCheck(check);
      }
      item.summary = summarizeTask(item.task, result);
      item.status = "done";
    } catch (error) {
      item.status = "failed";
      item.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      this.logger.warn(`Tugas agen e-Kinerja "${item.label}" gagal: ${item.error}`);
    } finally {
      item.finishedAt = new Date().toISOString();
    }
  }

  /** Status sesi konektor + tugas agen terakhir (terbaru dulu). */
  async status(user: AuthUser) {
    const connector = (await this.robot.connectors(user.id)).find((c) => c.system === "ekinerja");
    return {
      sesi: !connector?.hasSession
        ? "belum login — pemilik perlu login di e-Kinerja → Connector"
        : connector.status === "expired"
          ? "kedaluwarsa — pemilik perlu login ulang di e-Kinerja → Connector"
          : "tersimpan",
      pemeriksaan_sesi_terakhir: connector?.lastCheckAt ?? null,
      galat_terakhir: connector?.lastError ?? null,
      tugas: this.tasks.get(user.id) ?? [],
    };
  }
}
