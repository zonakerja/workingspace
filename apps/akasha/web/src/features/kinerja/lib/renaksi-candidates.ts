import { formatLocalYMD } from "@/lib/dates";
import type {
  ActionPlanEntry,
  Activity,
  Area,
  AttachedResource,
  Project,
  ProjectTask,
  Schedule,
} from "@/types/entities";

/**
 * Kandidat renaksi e-Kinerja dari Working Space (logika murni, diuji di `renaksi-candidates.test.ts`; salinan backend
 * `backend/src/robot/renaksi-candidates.ts` — ubah keduanya bersamaan).
 *
 * Working Space tidak punya tombol e-Kinerja: menu e-Kinerja menarik kegiatan satu bulan (Action/Task yang selesai /
 * jatuh tempo, Agenda, Kegiatan & Sub Kegiatan bertenggat). Hermes mengusulkan pemetaan ke RHK + narasi (entri
 * `proposed`), dan pemilik memutuskan lewat centang.
 */

export type CandidateSource = "task" | "schedule" | "activity";

export interface RenaksiCandidate {
  sourceType: CandidateSource;
  sourceId: string;
  title: string;
  description: string;
  /** Tanggal acuan (YYYY-MM-DD) */
  date: string;
  done: boolean | null;
  parentTitle: string | null;
  resources: AttachedResource[];
  /** Cakupan: `area:<id>` / `project:<id>`, atau `loose` (tanpa Area & Project) — dasar filter */
  scope: string[];
  scopeLabel: string;
}

/** Kunci cakupan kegiatan lepas (agenda / task tanpa Area & Project). */
export const LOOSE_SCOPE = "loose";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const inPeriod = (date: string, period: string) => !!date && date.startsWith(`${period}-`);

export function renaksiCandidates(
  period: string,
  data: { tasks: ProjectTask[]; schedules: Schedule[]; activities: Activity[]; projects: Project[]; areas?: Area[] },
): RenaksiCandidate[] {
  const own = <T extends { share?: unknown }>(list: T[]) => list.filter((x) => !x.share);
  const areaTitle = (id?: string) => {
    const area = id ? (data.areas ?? []).find((a) => a.id === id) : undefined;
    return area ? str(area.title) || "Area" : null;
  };
  const scopeOf = (parentId?: string, activity?: Activity) => {
    const keys: string[] = [];
    const labels: string[] = [];
    const addArea = (id?: string) => {
      const title = areaTitle(id);
      if (!title) return;
      keys.push(`area:${id}`);
      labels.push(title);
    };
    if (activity) addArea(activity.areaId);
    else if (parentId) {
      const project = data.projects.find((p) => p.id === parentId);
      const parentActivity = project ? undefined : data.activities.find((a) => a.id === parentId);
      if (project) {
        addArea(project.areaId);
        keys.push(`project:${parentId}`);
        labels.push(str(project.title) || "Project");
      } else if (parentActivity) addArea(parentActivity.areaId);
    }
    return keys.length
      ? { scope: keys, scopeLabel: labels.join(" · ") }
      : { scope: [LOOSE_SCOPE], scopeLabel: "Lepas" };
  };
  const titleOf = (id?: string) => {
    if (!id) return null;
    const hit = [...data.projects, ...data.activities].find((x) => x.id === id);
    return hit ? str(hit.title) || null : null;
  };
  const out: RenaksiCandidate[] = [];

  for (const t of own(data.tasks)) {
    const done = t.completed === true;
    const date = (done && (formatLocalYMD(t.completedAt) || ymd(t.dueDate))) || ymd(t.dueDate);
    if (!inPeriod(date, period)) continue;
    out.push({
      sourceType: "task",
      sourceId: t.id,
      title: str(t.title),
      description: str(t.description),
      date,
      done,
      parentTitle: titleOf(t.projectId),
      resources: t.resources ?? [],
      ...scopeOf(t.projectId),
    });
  }

  const first = `${period}-01`;
  const last = `${period}-31`;
  for (const s of own(data.schedules)) {
    const start = ymd(s.startDate) || ymd(s.date);
    const end = ymd(s.endDate) || start;
    if (!start || start > last || end < first) continue;
    out.push({
      sourceType: "schedule",
      sourceId: s.id,
      title: str(s.title),
      description: str(s.outcome) || str(s.description),
      date: start < first ? first : start,
      done: null,
      parentTitle: titleOf(s.projectId),
      resources: [...(s.results ?? []), ...(s.resources ?? [])],
      ...scopeOf(s.projectId),
    });
  }

  for (const a of own(data.activities)) {
    if (!a.parentId) continue;
    const date = ymd(a.deadline);
    if (!inPeriod(date, period)) continue;
    out.push({
      sourceType: "activity",
      sourceId: a.id,
      title: str(a.title),
      description: str(a.description),
      date,
      done: null,
      parentTitle: titleOf(a.parentId),
      resources: a.resources ?? [],
      ...scopeOf(a.parentId, a),
    });
  }

  return out.filter((c) => c.title).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Keadaan satu kegiatan di bulan itu: entri yang sudah dimasukkan pemilik dan usulan Hermes yang belum diputuskan. */
export function candidateState(entries: ActionPlanEntry[], period: string, sourceId: string) {
  const mine = entries.filter((e) => e.period === period && e.sourceId === sourceId && !e.deleted);
  return { accepted: mine.filter((e) => !e.proposed), proposals: mine.filter((e) => e.proposed) };
}

export type CandidateFilter = "all" | "open" | "proposed" | "accepted";

/** Saringan daftar kegiatan: belum diputuskan (tanpa entri), ada usulan Hermes, sudah masuk e-Kinerja. */
export function matchesFilter(state: ReturnType<typeof candidateState>, filter: CandidateFilter) {
  if (filter === "accepted") return state.accepted.length > 0;
  if (filter === "proposed") return state.proposals.length > 0 && !state.accepted.length;
  if (filter === "open") return !state.accepted.length && !state.proposals.length;
  return true;
}

/** Usulan yang kegiatannya tidak lagi ada di daftar bulan itu (mis. tanggal tugas dipindah) — tetap bisa diabaikan. */
export const orphanProposals = (entries: ActionPlanEntry[], period: string, candidates: RenaksiCandidate[]) =>
  entries.filter(
    (e) => e.period === period && e.proposed && !e.deleted && !candidates.some((c) => c.sourceId === e.sourceId),
  );

/** Kegiatan dikecualikan bila salah satu cakupannya ada di daftar pengecualian (sama dengan backend). */
export const isExcluded = (candidate: Pick<RenaksiCandidate, "scope">, excluded: readonly string[]) =>
  candidate.scope.some((key) => excluded.includes(key));

export interface ScopeOption {
  key: string;
  label: string;
  /** Area induk project (keterangan) */
  hint?: string;
  /** Jumlah kegiatan bulan ini di cakupan ini */
  count: number;
  /** Project di dalam Area: kunci area-nya (area dikecualikan = project ikut) */
  areaKey?: string;
}

/**
 * Pilihan filter cakupan: semua Area, Project (di bawah area atau bebas), dan "Lepas". Hanya milik sendiri. Yang belum
 * pernah dikecualikan otomatis ikut (pengecualian disimpan, bukan daftar yang dipilih).
 */
export function scopeOptions(
  areas: Area[],
  projects: Project[],
  candidates: RenaksiCandidate[],
): { areas: ScopeOption[]; projects: ScopeOption[]; loose: ScopeOption } {
  const count = (key: string) => candidates.filter((c) => c.scope.includes(key)).length;
  const ownAreas = areas.filter((a) => !a.share);
  const areaName = (id?: string) => ownAreas.find((a) => a.id === id)?.title;
  const byTitle = (a: ScopeOption, b: ScopeOption) => a.label.localeCompare(b.label);
  return {
    areas: ownAreas
      .map((a) => ({ key: `area:${a.id}`, label: a.title || "Area", count: count(`area:${a.id}`) }))
      .sort(byTitle),
    projects: projects
      .filter((p) => !p.share)
      .map((p) => ({
        key: `project:${p.id}`,
        label: p.title || "Project",
        hint: areaName(p.areaId) ?? "Free Project",
        count: count(`project:${p.id}`),
        areaKey: areaName(p.areaId) ? `area:${p.areaId}` : undefined,
      }))
      .sort(byTitle),
    loose: { key: LOOSE_SCOPE, label: "Lepas (tanpa Area & Project)", count: count(LOOSE_SCOPE) },
  };
}

/** Teks tombol filter: "Semua cakupan" atau "n dikecualikan". */
export const scopeSummary = (excluded: readonly string[]) =>
  excluded.length ? `${excluded.length} cakupan dikecualikan` : "Semua cakupan";
