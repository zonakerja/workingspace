import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { ChatService } from "../chat/chat.service";
import { StreamSink } from "../chat/stream-sink";
import type { Caller } from "../common/caller";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SsoService } from "../auth/sso.service";
import { MailService } from "./mail.service";
import {
  SCHEDULE_LIMITS,
  type Schedule,
  TIMEZONES,
  describeSchedule,
  nextRun,
  resultMail,
  runLabel,
  validateSchedule,
} from "./schedule-logic";

export type ScheduleInput = {
  name?: string;
  prompt?: string;
  schedule?: unknown;
  timezone?: string;
  modelId?: string | null;
  projectId?: string | null;
  email?: boolean;
  enabled?: boolean;
};

type TaskRow = Prisma.ScheduledTaskGetPayload<object>;

/** Selang pemeriksaan tugas yang jatuh tempo. */
const TICK_MS = 30_000;

/**
 * Tugas terjadwal Akai (6b.8, docs/AKAI.md §8): prompt milik pemilik dijalankan menurut jadwal lewat jalur chat yang sama (skill,
 * konektor, plugin, memori dipakai; memori tidak dicatat) → percakapan baru bertanda belum dibaca (+ email opsional). Pemeriksa jadwal
 * berjalan di proses Akai API (satu instans); tugas diklaim lewat pembaruan bersyarat sehingga tidak jalan dua kali.
 */
@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulesService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();
  private readonly webUrl: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly mail: MailService,
    private readonly sso: SsoService,
    config: ConfigService,
  ) {
    const explicit = config.get<string>("AKAI_WEB_URL");
    const redirect = config.get<string>("SSO_REDIRECT_URI");
    this.webUrl = explicit ? explicit.replace(/\/+$/, "") : redirect ? new URL(redirect).origin : null;
  }

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick().catch((e: unknown) => this.logger.warn(`Penjadwal: ${String(e)}`)),
      TICK_MS,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Tugas terjadwal hanya untuk Akai web.");
  }

  private view(row: TaskRow) {
    const schedule = row.schedule as unknown as Schedule;
    return {
      ...row,
      schedule,
      describe: describeSchedule(schedule, row.timezone),
      running: this.running.has(row.id),
    };
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const rows = await this.prisma.scheduledTask.findMany({
      where: { accountId: caller.account.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      tasks: rows.map((r) => this.view(r)),
      emailTo: caller.account.email,
      emailDelivering: this.mail.delivering,
      timezones: Object.entries(TIMEZONES).map(([id, t]) => ({ id, label: t.label })),
    };
  }

  private async own(caller: Caller, id: string) {
    const row = await this.prisma.scheduledTask.findFirst({ where: { id, accountId: caller.account.id } });
    if (!row) throw new NotFoundException("Tugas terjadwal tidak ditemukan.");
    return row;
  }

  /** Periksa isian (gabung dengan nilai lama) → data siap simpan. */
  private async resolve(caller: Caller, input: ScheduleInput, current?: TaskRow) {
    const name = (input.name ?? current?.name ?? "").trim().slice(0, SCHEDULE_LIMITS.nameChars);
    if (!name) throw new BadRequestException("Nama tugas wajib diisi.");
    const prompt = (input.prompt ?? current?.prompt ?? "").trim();
    if (!prompt) throw new BadRequestException("Perintah (prompt) wajib diisi.");
    if (prompt.length > SCHEDULE_LIMITS.promptChars)
      throw new BadRequestException(`Perintah maks. ${SCHEDULE_LIMITS.promptChars.toLocaleString("id-ID")} karakter.`);
    const checked = validateSchedule(input.schedule ?? current?.schedule);
    if (!checked.schedule) throw new BadRequestException(checked.error);
    const timezone = input.timezone ?? current?.timezone ?? "Asia/Jakarta";
    if (!TIMEZONES[timezone])
      throw new BadRequestException("Zona waktu: Asia/Jakarta, Asia/Makassar, atau Asia/Jayapura.");
    const modelId = input.modelId === undefined ? (current?.modelId ?? null) : input.modelId;
    if (modelId && !(await this.prisma.aiModel.findFirst({ where: { id: modelId, accountId: caller.account.id } })))
      throw new BadRequestException("Model tidak ditemukan.");
    const projectId = input.projectId === undefined ? (current?.projectId ?? null) : input.projectId;
    if (projectId && !(await this.prisma.project.findFirst({ where: { id: projectId, accountId: caller.account.id } })))
      throw new BadRequestException("Proyek tidak ditemukan.");
    const enabled = input.enabled ?? current?.enabled ?? true;
    return {
      name,
      prompt,
      schedule: checked.schedule as unknown as Prisma.InputJsonValue,
      timezone,
      modelId,
      projectId,
      email: input.email ?? current?.email ?? false,
      enabled,
      nextRunAt: enabled ? nextRun(checked.schedule, timezone, new Date()) : null,
    };
  }

  async create(caller: Caller, input: ScheduleInput) {
    this.requireWeb(caller);
    const count = await this.prisma.scheduledTask.count({ where: { accountId: caller.account.id } });
    if (count >= SCHEDULE_LIMITS.maxTasks)
      throw new BadRequestException(`Maks. ${SCHEDULE_LIMITS.maxTasks} tugas terjadwal.`);
    const data = await this.resolve(caller, input);
    const row = await this.prisma.scheduledTask.create({ data: { ...data, accountId: caller.account.id } });
    return this.view(row);
  }

  async update(caller: Caller, id: string, input: ScheduleInput) {
    this.requireWeb(caller);
    const current = await this.own(caller, id);
    const data = await this.resolve(caller, input, current);
    return this.view(await this.prisma.scheduledTask.update({ where: { id }, data }));
  }

  async remove(caller: Caller, id: string) {
    this.requireWeb(caller);
    const done = await this.prisma.scheduledTask.deleteMany({ where: { id, accountId: caller.account.id } });
    if (!done.count) throw new NotFoundException("Tugas terjadwal tidak ditemukan.");
  }

  /** Riwayat = percakapan hasil tugas ini (terbaru dulu). */
  async runs(caller: Caller, id: string) {
    this.requireWeb(caller);
    await this.own(caller, id);
    return this.prisma.conversation.findMany({
      where: { scheduledTaskId: id, accountId: caller.account.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, title: true, unread: true, createdAt: true },
    });
  }

  /** Jalankan sekarang (di latar belakang). */
  async runNow(caller: Caller, id: string) {
    this.requireWeb(caller);
    const task = await this.own(caller, id);
    if (this.running.has(id)) throw new BadRequestException("Tugas ini sedang berjalan.");
    void this.execute(task);
    return { started: true };
  }

  /** Tugas jatuh tempo: klaim (geser next_run_at lebih dulu, bersyarat) lalu jalankan. */
  async tick(now = new Date()) {
    const due = await this.prisma.scheduledTask.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: 5,
    });
    for (const task of due) {
      const next = nextRun(task.schedule as unknown as Schedule, task.timezone, now);
      const claimed = await this.prisma.scheduledTask.updateMany({
        where: { id: task.id, nextRunAt: task.nextRunAt },
        data: { nextRunAt: next },
      });
      if (claimed.count && !this.running.has(task.id)) void this.execute(task);
    }
  }

  private async execute(task: TaskRow) {
    this.running.add(task.id);
    const started = new Date();
    let answer: string;
    let error: string | null = null;
    try {
      const account = await this.prisma.account.findUnique({ where: { id: task.accountId } });
      if (!account) return;
      // Akun dinonaktifkan / akses Akai dicabut di SSO: tugas tidak dijalankan (tidak memakai kuota model, tidak mengirim email)
      if (!(await this.sso.stillAllowed(account.ssoSubject))) {
        error = "Akses Akai akun ini dicabut atau dinonaktifkan di SSO; tugas tidak dijalankan.";
        return;
      }
      const caller: Caller = { clientId: "web", account };
      const projectId =
        task.projectId &&
        (await this.prisma.project.findFirst({ where: { id: task.projectId, accountId: account.id } }))
          ? task.projectId
          : null;
      const modelId =
        task.modelId && (await this.prisma.aiModel.findFirst({ where: { id: task.modelId, accountId: account.id } }))
          ? task.modelId
          : null;
      const conversation = await this.prisma.conversation.create({
        data: {
          accountId: account.id,
          title: `${task.name} · ${runLabel(started, task.timezone)}`.slice(0, 120),
          projectId,
          modelId,
          scheduledTaskId: task.id,
          unread: true,
        },
      });
      const sink = new StreamSink(() => {});
      try {
        await this.chat.send(
          caller,
          conversation.id,
          { content: task.prompt, skipMemory: true },
          sink as unknown as Response,
        );
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const reply = await this.prisma.chatMessage.findFirst({
        where: { conversationId: conversation.id, role: "assistant" },
        orderBy: { createdAt: "desc" },
      });
      answer = reply?.content ?? "";
      error = reply?.error ?? error ?? (answer ? null : "Model tidak memberikan jawaban.");
      if (task.email && account.email)
        await this.mail
          .send(
            account.email,
            resultMail({
              taskName: task.name,
              when: runLabel(started, task.timezone),
              answer,
              error,
              link: this.webUrl ? `${this.webUrl}/chat/${conversation.id}` : null,
            }),
          )
          .catch((e: unknown) => this.logger.warn(`Email tugas terjadwal gagal: ${String(e)}`));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Tugas terjadwal ${task.id} gagal: ${error}`);
    } finally {
      this.running.delete(task.id);
      await this.prisma.scheduledTask
        .update({
          where: { id: task.id },
          data: {
            lastRunAt: started,
            lastStatus: error ? "error" : "ok",
            lastError: error?.slice(0, 500) ?? null,
            runCount: { increment: 1 },
          },
        })
        .catch(() => undefined);
    }
  }
}
