import {
  AlertTriangle,
  Archive,
  BarChart3,
  Box,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Grid2x2,
  HeartPulse,
  Layers,
} from "lucide-react";
import { useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import {
  useActivities,
  useAreas,
  useParaArchives,
  useProjects,
  useProjectTasks,
  useResources,
} from "@/data/collections";
import { useSearchParam } from "@/hooks/use-search-param";
import { useToday } from "@/hooks/use-today";
import { formatLocalYMD, formatNumericDate, parseLocalYMD } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Area } from "@/types/entities";
import { type EnrichedTask, enrichTasks } from "../lib/para";
import {
  type ProjectHealthState,
  areaSummaries,
  runningProjectHealth,
  upcomingWork,
  weeklyCompletions,
} from "../lib/workspace-overview";
import { DayDetailDialog, ParaCalendar } from "./para-calendar";

const HEALTH_STYLE: Record<ProjectHealthState, { label: string; className: string }> = {
  late: { label: "Terlambat", className: "bg-destructive/12 text-destructive" },
  risk: { label: "Berisiko", className: "bg-warning/15 text-warning" },
  "on-track": { label: "Sesuai jadwal", className: "bg-success/12 text-success" },
  "no-date": { label: "Tanpa deadline", className: "bg-muted text-muted-foreground" },
};

const ARCHIVE_LABEL = { project: "project", area: "area", resource: "resource", activity: "item area" };

const PROJECT_LIMIT = 6;
const WORK_LIMIT = 8;

const shortDate = (ymd: string) => parseLocalYMD(ymd).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

export function OverviewTab({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const today = useToday();
  const { items: projects } = useProjects();
  const { items: areas } = useAreas();
  const { items: resources } = useResources();
  const { items: archives } = useParaArchives();
  const { items: tasks } = useProjectTasks();
  const { items: activities } = useActivities();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [, setTaskId] = useSearchParam("task");

  const enriched = enrichTasks(tasks, projects, activities);
  const health = runningProjectHealth(projects, tasks, today);
  const attention = health.filter((h) => h.state === "late" || h.state === "risk").length;
  const work = upcomingWork(enriched, today);
  const weeks = weeklyCompletions(tasks, today);
  const areaRows = areaSummaries(areas, projects, activities, tasks);
  const fileResources = resources.filter((r) => String(r.type).toLowerCase() === "file").length;
  const completedProjects = projects.filter((p) => p.status === "completed").length;

  const archiveSub =
    archives.length === 0
      ? "Belum ada arsip"
      : (["project", "area", "resource", "activity"] as const)
          .map((type) => [type, archives.filter((a) => a.originalType === type).length] as const)
          .filter(([, n]) => n > 0)
          .map(([type, n]) => `${n} ${ARCHIVE_LABEL[type]}`)
          .join(" · ");

  const stats = [
    {
      label: "Projects",
      value: projects.length,
      sub: `${health.length} berjalan · ${completedProjects} selesai`,
      icon: Layers,
      module: "overview",
    },
    {
      label: "Areas",
      value: areas.length,
      sub: `${activities.length} sub area & kegiatan`,
      icon: Grid2x2,
      module: "productivity",
    },
    {
      label: "Resources",
      value: resources.length,
      sub: `${fileResources} berkas · ${resources.length - fileResources} lainnya`,
      icon: Box,
      module: "notes",
    },
    {
      label: "Archives",
      value: archives.length,
      sub: archiveSub,
      icon: Archive,
      module: "settings",
    },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            data-module={s.module}
            className="relative overflow-hidden rounded-2xl bg-module-gradient p-4 text-white shadow-md shadow-module/20"
          >
            <div className="pointer-events-none absolute -right-6 -bottom-6 size-24 rounded-full bg-white/15" />
            <s.icon className="mb-2 size-6 opacity-85" />
            <p className="text-sm font-medium text-white/85">{s.label}</p>
            <p className="text-3xl leading-tight font-extrabold">{s.value}</p>
            <p className="mt-0.5 truncate text-xs text-white/80">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          icon={HeartPulse}
          title="Kesehatan Project"
          description={
            health.length
              ? `${health.length} project berjalan${attention ? ` · ${attention} perlu perhatian` : ""}`
              : "Belum ada project berjalan"
          }
          className="lg:col-span-3"
          contentClassName="flex flex-col gap-2"
        >
          {health.length === 0 ? (
            <EmptyNote text="Tidak ada project berjalan. Project selesai/ditunda tidak ditampilkan di sini." />
          ) : (
            <>
              {health.slice(0, PROJECT_LIMIT).map(({ project: p, taskPct, timePct, state, openTasks: open }) => {
                const area = areas.find((a) => a.id === p.areaId);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 text-left transition-shadow hover:shadow-md md:flex-row md:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge className={HEALTH_STYLE[state].className}>{HEALTH_STYLE[state].label}</Badge>
                        <Badge variant="outline" className="max-w-40 truncate">
                          {area ? area.title : "Free Project"}
                        </Badge>
                        {p.deadline && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="size-3" /> {formatNumericDate(p.deadline)}
                          </span>
                        )}
                      </div>
                      <h4 className="truncate text-sm font-bold">{p.title}</h4>
                      <p className="text-xs text-muted-foreground">{open} action terbuka</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 md:w-2/5">
                      <MiniProgress label="Progres action" value={taskPct} className="bg-primary" />
                      <MiniProgress label="Waktu berjalan" value={timePct} className="bg-info" />
                    </div>
                  </button>
                );
              })}
              {health.length > PROJECT_LIMIT && (
                <p className="text-center text-xs text-muted-foreground">
                  +{health.length - PROJECT_LIMIT} project lainnya di tab Projects
                </p>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          icon={CalendarClock}
          title="Pekerjaan 7 Hari"
          description={`${work.overdue.length} terlambat · ${work.upcoming.length} jatuh tempo`}
          className="lg:col-span-2"
          contentClassName="flex flex-col gap-3"
        >
          {work.overdue.length === 0 && work.upcoming.length === 0 ? (
            <EmptyNote text="Tidak ada action/task yang terlambat atau jatuh tempo minggu ini." />
          ) : (
            <>
              <WorkList
                title="Terlambat"
                icon={AlertTriangle}
                tone="text-destructive"
                items={work.overdue}
                onOpen={(id) => setTaskId(id, { replace: false })}
              />
              <WorkList
                title="Minggu ini"
                icon={Clock}
                tone="text-module"
                items={work.upcoming}
                today={formatLocalYMD(today)}
                onOpen={(id) => setTaskId(id, { replace: false })}
              />
            </>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          icon={BarChart3}
          title="Selesai per Minggu"
          description={`${weeks.reduce((n, w) => n + w.count, 0)} action/task dalam 8 minggu`}
          className="lg:col-span-2"
        >
          <WeekBars weeks={weeks} />
        </SectionCard>
        <SectionCard
          icon={Grid2x2}
          title="Ringkasan Area"
          description={areas.length ? "Urut task terbuka terbanyak" : "Belum ada area"}
          className="lg:col-span-3"
          contentClassName="flex flex-col gap-1.5"
        >
          {areaRows.length === 0 ? (
            <EmptyNote text="Buat Area di tab Areas untuk tanggung jawab yang berkelanjutan." />
          ) : (
            areaRows.slice(0, 6).map((row) => <AreaRow key={row.area.id} {...row} />)
          )}
        </SectionCard>
      </div>

      <ParaCalendar projects={projects} tasks={enriched} onDateClick={setSelectedDate} />

      <DayDetailDialog
        date={selectedDate}
        projects={projects}
        tasks={enriched}
        onOpenChange={(open) => !open && setSelectedDate(null)}
      />
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Empty className="border border-dashed py-6">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function WorkList({
  title,
  icon: Icon,
  tone,
  items,
  today,
  onOpen,
}: {
  title: string;
  icon: typeof Clock;
  tone: string;
  items: EnrichedTask[];
  today?: string;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className={cn("flex items-center gap-1.5 text-xs font-bold uppercase", tone)}>
        <Icon className="size-3.5" /> {title} ({items.length})
      </p>
      {items.slice(0, WORK_LIMIT).map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t.id)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t.kind === "area-task" ? "Task" : "Action"} · {t.parentName || "—"}
            </p>
          </div>
          <span className={cn("shrink-0 text-xs font-semibold", tone)}>
            {t.dueDate === today ? "Hari ini" : shortDate(t.dueDate!)}
          </span>
        </button>
      ))}
      {items.length > WORK_LIMIT && (
        <p className="px-2 text-xs text-muted-foreground">+{items.length - WORK_LIMIT} lainnya</p>
      )}
    </div>
  );
}

function WeekBars({ weeks }: { weeks: { start: string; count: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Jumlah action/task selesai per minggu">
      {weeks.map((w, i) => {
        const current = i === weeks.length - 1;
        return (
          <div key={w.start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-semibold tabular-nums">{w.count || ""}</span>
            <div
              className={cn("w-full rounded-t-md", current ? "bg-module" : "bg-module/45")}
              style={{ height: `${Math.max(4, (w.count / max) * 100)}%` }}
              title={`Minggu ${shortDate(w.start)}: ${w.count} selesai`}
            />
            <span className={cn("truncate text-[10px]", current ? "font-bold" : "text-muted-foreground")}>
              {current ? "Ini" : shortDate(w.start)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AreaRow({
  area,
  projects,
  items,
  openTasks,
  totalTasks,
  progress,
}: {
  area: Area;
  projects: number;
  items: number;
  openTasks: number;
  totalTasks: number;
  progress: number;
}) {
  const [, setAreaId] = useSearchParam("area");
  return (
    <button
      type="button"
      onClick={() => setAreaId(area.id, { replace: false })}
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{area.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {projects} project · {items} item area · {openTasks} task terbuka
        </p>
      </div>
      <div className="flex w-28 shrink-0 items-center gap-2">
        <Progress value={progress} className="h-1.5" indicatorClassName="bg-success" />
        <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
          {totalTasks ? `${progress.toFixed(0)}%` : "—"}
        </span>
      </div>
      {openTasks === 0 && totalTasks > 0 && <CheckCircle2 className="size-4 shrink-0 text-success" />}
    </button>
  );
}

/** Tombol aksi ikon di kartu Project/Area: lebih kecil dari icon-sm agar tidak mendesak judul. */
export const CARD_ACTION_CLASS = "size-7 [&_svg:not([class*='size-'])]:size-3.5";

export function MiniProgress({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-bold text-muted-foreground uppercase">
        <span>{label}</span>
        <span>{value.toFixed(0)}%</span>
      </div>
      <Progress value={value} className="h-1.5" indicatorClassName={className} />
    </div>
  );
}
