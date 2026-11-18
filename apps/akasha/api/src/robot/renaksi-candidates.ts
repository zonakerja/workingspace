/**
 * Kandidat renaksi e-Kinerja dari Working Space (logika murni, diuji di `renaksi-candidates.spec.ts`; salinan frontend
 * `features/kinerja/lib/renaksi-candidates.ts` — ubah keduanya bersamaan).
 *
 * Working Space tidak tahu apa-apa tentang e-Kinerja: menu e-Kinerja yang "menarik" kegiatan satu bulan (Action/Task yang
 * selesai / jatuh tempo, Agenda, Kegiatan & Sub Kegiatan bertenggat), lalu Hermes memetakan ke RHK dan menyusun narasi
 * Renaksi + Realisasi sebagai **usulan** (`proposed: true`). Pemilik yang memutuskan mana yang masuk e-Kinerja.
 */

type Payload = Record<string, unknown>;
type CandidateSource = "task" | "schedule" | "activity";

export interface RenaksiCandidate {
  sourceType: CandidateSource;
  sourceId: string;
  title: string;
  description: string;
  /** Tanggal acuan (YYYY-MM-DD): selesai / tenggat / mulai agenda */
  date: string;
  /** Action/Task sudah dicentang selesai; agenda & kegiatan = null */
  done: boolean | null;
  /** Project / Kegiatan / Sub Area induk */
  parentTitle: string | null;
  /** Lampiran item (nama + uploadId/url) — bahan Realisasi & bukti */
  attachments: { name: string; uploadId?: string; url?: string }[];
  /** Cakupan Working Space: kunci `area:<id>` / `project:<id>`, atau `loose` (tanpa Area & Project) — dasar filter */
  scope: string[];
  /** "Area X · Project Y" / "Lepas" (untuk agen & tampilan) */
  scopeLabel: string;
}

/** Kunci cakupan kegiatan lepas (agenda / task tanpa Area & Project). */
export const LOOSE_SCOPE = "loose";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");

/** Tanggal lokal WIB dari waktu ISO (completedAt). */
export function jakartaYmd(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return ymd(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

const inPeriod = (date: string, period: string) => !!date && date.startsWith(`${period}-`);

function attachmentsOf(...lists: unknown[]) {
  const out: RenaksiCandidate["attachments"] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list as Payload[]) {
      const name = str(item?.name) || str(item?.title) || str(item?.fileName);
      const uploadId = str(item?.uploadId) || undefined;
      const url = str(item?.url) || undefined;
      if (name || uploadId || url) out.push({ name: name || "(lampiran)", uploadId, url });
    }
  }
  return out;
}

/**
 * Kegiatan satu bulan dari data milik sendiri. `items` = payload record; item bersama (milik orang lain) tidak
 * dimasukkan pemanggil.
 */
export function renaksiCandidates(
  period: string,
  data: { tasks: Payload[]; schedules: Payload[]; activities: Payload[]; projects: Payload[]; areas?: Payload[] },
): RenaksiCandidate[] {
  const areas = data.areas ?? [];
  const areaTitle = (id: unknown) => {
    const area = areas.find((a) => a.id === str(id));
    return area ? str(area.title) || "Area" : null;
  };
  /** Cakupan dari induk langsung (Project atau item Area) atau dari item Area itu sendiri. */
  const scopeOf = (parentId: unknown, activity?: Payload) => {
    const keys: string[] = [];
    const labels: string[] = [];
    const addArea = (id: unknown) => {
      const title = areaTitle(id);
      if (!title) return;
      keys.push(`area:${str(id)}`);
      labels.push(title);
    };
    if (activity) addArea(activity.areaId);
    else {
      const id = str(parentId);
      const project = id ? data.projects.find((p) => p.id === id) : undefined;
      const parentActivity = id && !project ? data.activities.find((a) => a.id === id) : undefined;
      if (project) {
        addArea(project.areaId);
        keys.push(`project:${id}`);
        labels.push(str(project.title) || "Project");
      } else if (parentActivity) addArea(parentActivity.areaId);
    }
    return keys.length
      ? { scope: keys, scopeLabel: labels.join(" · ") }
      : { scope: [LOOSE_SCOPE], scopeLabel: "Lepas" };
  };
  const titleOf = (id: unknown) => {
    const key = str(id);
    if (!key) return null;
    const hit = [...data.projects, ...data.activities].find((x) => x.id === key);
    return hit ? str(hit.title) || null : null;
  };
  const out: RenaksiCandidate[] = [];

  for (const t of data.tasks) {
    const done = t.completed === true;
    const date = (done && (jakartaYmd(t.completedAt) || ymd(t.dueDate))) || ymd(t.dueDate);
    if (!inPeriod(date, period)) continue;
    out.push({
      sourceType: "task",
      sourceId: String(t.id),
      title: str(t.title),
      description: str(t.description),
      date,
      done,
      parentTitle: titleOf(t.projectId),
      attachments: attachmentsOf(t.resources),
      ...scopeOf(t.projectId),
    });
  }

  const first = `${period}-01`;
  const last = `${period}-31`;
  for (const s of data.schedules) {
    const start = ymd(s.startDate) || ymd(s.date);
    const end = ymd(s.endDate) || start;
    if (!start || start > last || end < first) continue;
    out.push({
      sourceType: "schedule",
      sourceId: String(s.id),
      title: str(s.title),
      description: str(s.outcome) || str(s.description),
      date: start < first ? first : start,
      done: null,
      parentTitle: titleOf(s.projectId),
      attachments: attachmentsOf(s.results, s.resources),
      ...scopeOf(s.projectId),
    });
  }

  for (const a of data.activities) {
    // Sub Area (tanpa induk) = wadah tanpa tanggal; hanya Kegiatan & Sub Kegiatan
    if (!str(a.parentId)) continue;
    const date = ymd(a.deadline);
    if (!inPeriod(date, period)) continue;
    out.push({
      sourceType: "activity",
      sourceId: String(a.id),
      title: str(a.title),
      description: str(a.description),
      date,
      done: null,
      parentTitle: titleOf(a.parentId),
      attachments: attachmentsOf(a.resources),
      ...scopeOf(a.parentId, a),
    });
  }

  return out.filter((c) => c.title).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Kegiatan dikecualikan bila salah satu cakupannya (Area / Project / Lepas) ada di daftar pengecualian pemilik. */
export const isExcluded = (candidate: Pick<RenaksiCandidate, "scope">, excluded: Iterable<string>) => {
  const set = excluded instanceof Set ? excluded : new Set(excluded);
  return candidate.scope.some((key) => set.has(key));
};

/** Daftar pengecualian yang sah: kunci `area:`/`project:` atau `loose`, unik, maks. 200. */
export function normalizeExcluded(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter(
    (v): v is string => typeof v === "string" && (v === LOOSE_SCOPE || /^(area|project):[\w.~-]{1,120}$/.test(v)),
  );
  return [...new Set(keys)].slice(0, 200);
}

/** SKP yang periodenya mencakup bulan itu (sama dengan `skpsForPeriod` frontend). */
export function skpsForPeriod<T extends { startDate?: unknown; endDate?: unknown }>(skps: T[], period: string): T[] {
  const first = `${period}-01`;
  const last = `${period}-31`;
  return skps.filter((s) => {
    const start = ymd(s.startDate);
    const end = ymd(s.endDate);
    return !!start && !!end && start <= last && end >= first;
  });
}

export interface ProposalInput {
  sourceType: CandidateSource;
  sourceId: string;
  targetId: string;
  description: string;
  realization?: string;
  indicators?: string[];
  note?: string;
}

/**
 * Periksa usulan agen terhadap kandidat & RHK bulan itu. Mengembalikan usulan yang sah dan alasan penolakan per butir
 * agar agen bisa memperbaikinya. Sumber yang sudah dimasukkan pemilik (entri bukan usulan) tidak disentuh.
 */
export function checkProposals(
  items: ProposalInput[],
  candidates: RenaksiCandidate[],
  targets: { id: string; indicators?: { indicator: string }[] }[],
  acceptedSources: Set<string>,
) {
  const ok: ProposalInput[] = [];
  const rejected: { sourceId: string; reason: string }[] = [];
  for (const item of items) {
    const candidate = candidates.find((c) => c.sourceId === item.sourceId && c.sourceType === item.sourceType);
    const target = targets.find((t) => t.id === item.targetId);
    if (!candidate)
      rejected.push({ sourceId: item.sourceId, reason: "Bukan kegiatan bulan ini (lihat daftar kegiatan)." });
    else if (acceptedSources.has(item.sourceId))
      rejected.push({ sourceId: item.sourceId, reason: "Sudah dimasukkan pemilik — tidak diubah." });
    else if (!target) rejected.push({ sourceId: item.sourceId, reason: "RHK tidak ada di SKP bulan ini." });
    else if (!item.description.trim()) rejected.push({ sourceId: item.sourceId, reason: "Renaksi kosong." });
    else {
      const known = new Set((target.indicators ?? []).map((i) => i.indicator));
      const indicators = (item.indicators ?? []).filter((i) => known.has(i));
      ok.push({
        ...item,
        description: item.description.trim(),
        realization: item.realization?.trim() || undefined,
        // Semua / tidak ada yang cocok = kosong (berarti semua indikator RHK)
        indicators: indicators.length && indicators.length < known.size ? indicators : undefined,
      });
    }
  }
  return { ok, rejected };
}
