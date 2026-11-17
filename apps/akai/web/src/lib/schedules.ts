/** Klien tugas terjadwal Akai (6b.8, docs/AKAI.md §8). */
import { request } from "./api";

export type ScheduleKind = "hourly" | "daily" | "weekly" | "monthly";

export interface Schedule {
  kind: ScheduleKind;
  time: string;
  days: number[];
  dayOfMonth: number;
  everyHours: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  timezone: string;
  modelId: string | null;
  projectId: string | null;
  email: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  runCount: number;
  describe: string;
  running: boolean;
}

export interface ScheduleList {
  tasks: ScheduledTask[];
  emailTo: string | null;
  emailDelivering: boolean;
  timezones: { id: string; label: string }[];
}

export interface ScheduleRun {
  id: string;
  title: string;
  unread: boolean;
  createdAt: string;
}

export type ScheduleInput = Pick<
  ScheduledTask,
  "name" | "prompt" | "schedule" | "timezone" | "modelId" | "projectId" | "email" | "enabled"
>;

export const schedulesApi = {
  list: () => request<ScheduleList>("GET", "/api/schedules"),
  create: (body: ScheduleInput) => request<ScheduledTask>("POST", "/api/schedules", body),
  update: (id: string, body: Partial<ScheduleInput>) => request<ScheduledTask>("PATCH", `/api/schedules/${id}`, body),
  remove: (id: string) => request<void>("DELETE", `/api/schedules/${id}`),
  run: (id: string) => request<{ started: boolean }>("POST", `/api/schedules/${id}/run`),
  runs: (id: string) => request<ScheduleRun[]>("GET", `/api/schedules/${id}/runs`),
};

export const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export const KIND_LABEL: Record<ScheduleKind, string> = {
  hourly: "Setiap beberapa jam",
  daily: "Setiap hari",
  weekly: "Setiap minggu",
  monthly: "Setiap bulan",
};

export const emptySchedule = (): ScheduleInput => ({
  name: "",
  prompt: "",
  schedule: { kind: "daily", time: "07:00", days: [1, 2, 3, 4, 5], dayOfMonth: 1, everyHours: 4 },
  timezone: "Asia/Jakarta",
  modelId: null,
  projectId: null,
  email: false,
  enabled: true,
});

/** Tanggal & jam singkat (zona browser), mis. "Sen, 17 Nov 07.30". */
export const shortWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
