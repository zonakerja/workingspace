import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import { SYSTEM_INFO } from "./robot-logic";
import { RobotService } from "./robot.service";
import {
  SIMAN_TASK_LABELS,
  type SimanAgentTask,
  simanPageUrl,
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

  constructor(private readonly robot: RobotService) {}

  start(user: AuthUser, task: SimanAgentTask, url?: string) {
    let target = "";
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
    void this.execute(user, item);
    return item;
  }

  private async execute(user: AuthUser, item: AgentTask) {
    try {
      let result: unknown;
      if (item.task === "session") result = await this.robot.check(user.id, "siman", "agent");
      else {
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
      tugas: this.tasks.get(user.id) ?? [],
    };
  }
}
