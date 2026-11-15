import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import {
  isEntryId,
  SRIKANDI_TASK_LABELS,
  type SrikandiAgentTask,
  summarizeCheck,
  summarizeTask,
} from "./srikandi-agent-logic";
import { RecordsService } from "../records/records.service";
import { RobotService } from "./robot.service";

interface AgentTask {
  id: string;
  task: SrikandiAgentTask;
  label: string;
  /** ID entri Register (check) atau "" */
  target: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  /** Hasil ringkas untuk agen (hanya "check") */
  result: unknown;
}

const KEEP_PER_USER = 10;

/**
 * Robot SRIKANDI yang dijalankan agen lewat MCP — pola sama dengan `EkinerjaAgentService`: tugas dimulai di latar belakang
 * (bisa melebihi batas waktu MCP Hermes 180 dtk) dan dibaca lewat `srikandi_status`. Riwayat tugas ada di memori satu
 * proses; hasil sinkron tetap tersimpan sebagai record dan di riwayat Otomasi (pemicu "agent"). Hanya tugas yang
 * **membaca** SRIKANDI dan Periksa Register (dryRun); pendaftaran lewat permintaan yang disetujui pemilik.
 */
@Injectable()
export class SrikandiAgentService {
  private readonly logger = new Logger(SrikandiAgentService.name);
  private readonly tasks = new Map<string, AgentTask[]>();

  constructor(
    private readonly robot: RobotService,
    private readonly records: RecordsService,
  ) {}

  start(user: AuthUser, task: SrikandiAgentTask, entryId?: string) {
    if (task === "check" && !isEntryId(entryId)) throw new BadRequestException("ID entri Register wajib diisi.");
    const list = this.tasks.get(user.id) ?? [];
    const running = list.find((t) => t.status === "running");
    if (running) {
      throw new BadRequestException(
        `Robot SRIKANDI masih menjalankan "${running.label}". Tunggu sampai selesai — cek srikandi_status.`,
      );
    }
    const item: AgentTask = {
      id: randomUUID(),
      task,
      label: SRIKANDI_TASK_LABELS[task],
      target: task === "check" ? entryId! : "",
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
      if (item.task === "letters") result = await this.robot.syncSrikandiLetters(user, "agent");
      else if (item.task === "inbox") result = await this.robot.syncSrikandiInbox(user, "agent");
      else if (item.task === "references") result = await this.robot.syncSrikandiReferences(user, undefined, "agent");
      else if (item.task === "classifications")
        result = await this.robot.syncSrikandiReferences(user, ["classification"], "agent");
      else {
        const check = (await this.isRegistered(user, item.target))
          ? await this.robot.updateSrikandiOutgoing(user, item.target, true)
          : await this.robot.registerSrikandiOutgoing(user, item.target, true);
        result = check;
        item.result = summarizeCheck(check);
      }
      item.summary = summarizeTask(item.task, result);
      item.status = "done";
    } catch (error) {
      item.status = "failed";
      item.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      this.logger.warn(`Tugas agen SRIKANDI "${item.label}" gagal: ${item.error}`);
    } finally {
      item.finishedAt = new Date().toISOString();
    }
  }

  private async isRegistered(user: AuthUser, entryId: string) {
    const record = await this.records.findOne("srikandi_outgoing", entryId, {}, user);
    return (record.payload as { status?: string }).status === "submitted";
  }

  /** Status sesi konektor + tugas agen terakhir (terbaru dulu). */
  async status(user: AuthUser) {
    const connector = (await this.robot.connectors(user.id)).find((c) => c.system === "srikandi");
    return {
      sesi: !connector?.hasSession
        ? "belum login — pemilik perlu login di SRIKANDI → Connector"
        : connector.status === "expired"
          ? "kedaluwarsa — pemilik perlu login ulang di SRIKANDI → Connector"
          : "tersimpan",
      pemeriksaan_sesi_terakhir: connector?.lastCheckAt ?? null,
      galat_terakhir: connector?.lastError ?? null,
      tugas: this.tasks.get(user.id) ?? [],
    };
  }
}
