import { addDays, formatLocalYMD, parseLocalYMD } from "@/lib/dates";
import type { Activity, Area, Project, ProjectTask } from "@/types/entities";
import { isProjectRunning } from "@/features/overview/lib/overview-logic";
import { projectTaskProgress, projectTimeProgress, taskProgress } from "./progress";

/**
 * Logika murni Overview Working Space (diuji di `workspace-overview.test.ts`): kesehatan project, pekerjaan 7 hari,
 * jumlah selesai per minggu, dan ringkasan per Area.
 */

export type ProjectHealthState = "late" | "risk" | "on-track" | "no-date";

export interface ProjectHealth {
  project: Project;
  taskPct: number;
  timePct: number;
  state: ProjectHealthState;
  openTasks: number;
}

/** Selisih waktu berjalan − progres task yang dianggap berisiko (poin persen). */
export const RISK_GAP = 25;

export function projectHealth(project: Project, tasks: ProjectTask[], today: Date): ProjectHealth {
  const own = tasks.filter((t) => t.projectId === project.id);
  const taskPct = projectTaskProgress(project, tasks);
  const timePct = projectTimeProgress(project, today);
  const openTasks = own.filter((t) => !t.completed).length;
  const todayYmd = formatLocalYMD(today);
  let state: ProjectHealthState = "on-track";
  if (!project.deadline) state = "no-date";
  else if (project.deadline < todayYmd && taskPct < 100) state = "late";
  else if (project.startDate && timePct - taskPct >= RISK_GAP) state = "risk";
  return { project, taskPct, timePct, state, openTasks };
}

const HEALTH_ORDER: Record<ProjectHealthState, number> = { late: 0, risk: 1, "on-track": 2, "no-date": 3 };

/** Project berjalan (bukan selesai/ditunda/diarsipkan) + kesehatannya, yang paling perlu perhatian dulu. */
export function runningProjectHealth(projects: Project[], tasks: ProjectTask[], today: Date) {
  return projects
    .filter(isProjectRunning)
    .map((p) => projectHealth(p, tasks, today))
    .sort(
      (a, b) =>
        HEALTH_ORDER[a.state] - HEALTH_ORDER[b.state] ||
        (a.project.deadline || "9999-12-31").localeCompare(b.project.deadline || "9999-12-31") ||
        a.project.title.localeCompare(b.project.title),
    );
}

/** Action/Task belum selesai: terlambat (tenggat lewat) dan jatuh tempo hari ini s.d. `days` hari ke depan. */
export function upcomingWork<T extends ProjectTask>(tasks: T[], today: Date, days = 7) {
  const todayYmd = formatLocalYMD(today);
  const until = formatLocalYMD(addDays(today, days));
  const open = tasks.filter((t) => !t.completed && t.dueDate);
  const byDue = (a: T, b: T) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.title.localeCompare(b.title);
  return {
    overdue: open.filter((t) => t.dueDate! < todayYmd).sort(byDue),
    upcoming: open.filter((t) => t.dueDate! >= todayYmd && t.dueDate! <= until).sort(byDue),
  };
}

/** Senin minggu tanggal itu (lokal). */
const weekStart = (date: Date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

export interface WeekBucket {
  /** YMD Senin */
  start: string;
  count: number;
}

/** Jumlah Action/Task selesai per minggu (Senin–Minggu), `weeks` minggu terakhir termasuk minggu ini. */
export function weeklyCompletions(tasks: ProjectTask[], today: Date, weeks = 8): WeekBucket[] {
  const current = weekStart(today);
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) buckets.push({ start: formatLocalYMD(addDays(current, -7 * i)), count: 0 });
  const index = new Map(buckets.map((b, i) => [b.start, i]));
  for (const t of tasks) {
    if (!t.completed) continue;
    // Tanpa waktu selesai tercatat, dianggap selesai di tanggal tenggatnya
    const when = t.completedAt ? new Date(t.completedAt) : t.dueDate ? parseLocalYMD(t.dueDate) : null;
    if (!when || Number.isNaN(when.getTime())) continue;
    const i = index.get(formatLocalYMD(weekStart(when)));
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

export interface AreaSummary {
  area: Area;
  projects: number;
  items: number;
  openTasks: number;
  totalTasks: number;
  progress: number;
}

/** Per Area: jumlah project & item area, task terbuka, dan progres task (project berjalan + item area). */
export function areaSummaries(
  areas: Area[],
  projects: Project[],
  activities: Activity[],
  tasks: ProjectTask[],
): AreaSummary[] {
  return areas
    .map((area) => {
      const areaProjects = projects.filter((p) => p.areaId === area.id && isProjectRunning(p));
      const areaItems = activities.filter((a) => a.areaId === area.id);
      const owners = new Set([...areaProjects.map((p) => p.id), ...areaItems.map((a) => a.id)]);
      const own = tasks.filter((t) => owners.has(t.projectId));
      return {
        area,
        projects: areaProjects.length,
        items: areaItems.length,
        openTasks: own.filter((t) => !t.completed).length,
        totalTasks: own.length,
        progress: taskProgress(own),
      };
    })
    .sort((a, b) => b.openTasks - a.openTasks || a.area.title.localeCompare(b.area.title));
}
