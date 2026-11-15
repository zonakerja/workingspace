import { describe, expect, it } from "vitest";
import type { ActionPlanEntry, Activity, Area, Project, ProjectTask, Schedule } from "@/types/entities";
import {
  candidateState,
  isExcluded,
  LOOSE_SCOPE,
  matchesFilter,
  orphanProposals,
  renaksiCandidates,
  scopeOptions,
  scopeSummary,
} from "./renaksi-candidates";

const data = {
  projects: [{ id: "p1", title: "Laporan BMN" }] as Project[],
  activities: [
    { id: "sa", title: "Sub Area", areaId: "a" },
    { id: "k1", title: "Rekonsiliasi", areaId: "a", parentId: "sa", deadline: "2026-10-20" },
  ] as Activity[],
  tasks: [
    { id: "t1", title: "Susun laporan", projectId: "p1", completed: true, completedAt: "2026-10-03T03:00:00.000Z" },
    { id: "t2", title: "Tenggat Oktober", projectId: "p1", dueDate: "2026-10-05" },
    { id: "t3", title: "Bersama", projectId: "p1", dueDate: "2026-10-05", share: { permission: "view" } },
  ] as unknown as ProjectTask[],
  schedules: [
    { id: "s1", title: "Rapat", startDate: "2026-09-30", endDate: "2026-10-01", outcome: "Notulen" },
  ] as Schedule[],
};

const entry = (over: Partial<ActionPlanEntry>): ActionPlanEntry => ({
  id: over.id ?? "e",
  period: "2026-10",
  description: "x",
  status: "draft",
  ...over,
});

describe("kandidat renaksi (frontend)", () => {
  it("menarik kegiatan milik sendiri bulan itu, induk & ringkasan agenda ikut", () => {
    const list = renaksiCandidates("2026-10", data);
    expect(list.map((c) => c.sourceId)).toEqual(["s1", "t1", "t2", "k1"]);
    expect(list[0]).toMatchObject({ date: "2026-10-01", description: "Notulen" });
    expect(list.find((c) => c.sourceId === "t1")?.parentTitle).toBe("Laporan BMN");
  });

  it("keadaan & saringan: usulan, dimasukkan, belum diputuskan", () => {
    const entries = [
      entry({ id: "a", sourceId: "t1", proposed: true }),
      entry({ id: "b", sourceId: "t2" }),
      entry({ id: "c", sourceId: "zz", proposed: true }),
      entry({ id: "d", sourceId: "t1", period: "2026-09" }),
    ];
    const t1 = candidateState(entries, "2026-10", "t1");
    expect(t1.proposals.map((e) => e.id)).toEqual(["a"]);
    expect(matchesFilter(t1, "proposed")).toBe(true);
    expect(matchesFilter(candidateState(entries, "2026-10", "t2"), "accepted")).toBe(true);
    expect(matchesFilter(candidateState(entries, "2026-10", "k1"), "open")).toBe(true);
    const candidates = renaksiCandidates("2026-10", data);
    expect(orphanProposals(entries, "2026-10", candidates).map((e) => e.id)).toEqual(["c"]);
  });
});

describe("cakupan & filter kegiatan (frontend)", () => {
  const scoped = {
    areas: [
      { id: "a1", title: "Pengelolaan BMN" },
      { id: "a2", title: "Pribadi" },
    ] as Area[],
    projects: [
      { id: "p1", title: "Laporan BMN", areaId: "a1" },
      { id: "p2", title: "Proyek Bebas" },
    ] as Project[],
    activities: [
      { id: "s1", title: "Sub", areaId: "a2" },
      { id: "k1", title: "Olahraga", areaId: "a2", parentId: "s1", deadline: "2026-10-03" },
    ] as Activity[],
    tasks: [
      { id: "t1", title: "Susun laporan", projectId: "p1", dueDate: "2026-10-05" },
      { id: "t2", title: "Tugas bebas", projectId: "p2", dueDate: "2026-10-06" },
    ] as ProjectTask[],
    schedules: [{ id: "g1", title: "Rapat", date: "2026-10-08" }] as Schedule[],
  };

  it("cakupan sama dengan backend dan pengecualian bertingkat", () => {
    const list = renaksiCandidates("2026-10", scoped);
    expect(list.find((c) => c.sourceId === "t1")?.scope).toEqual(["area:a1", "project:p1"]);
    expect(list.find((c) => c.sourceId === "g1")?.scope).toEqual([LOOSE_SCOPE]);
    const kept = list.filter((c) => !isExcluded(c, ["area:a2", LOOSE_SCOPE])).map((c) => c.sourceId);
    expect(kept).toEqual(["t1", "t2"]);
  });

  it("pilihan filter: jumlah per cakupan, project tahu area induknya", () => {
    const options = scopeOptions(scoped.areas, scoped.projects, renaksiCandidates("2026-10", scoped));
    expect(options.areas.map((o) => [o.label, o.count])).toEqual([
      ["Pengelolaan BMN", 1],
      ["Pribadi", 1],
    ]);
    expect(options.projects.find((o) => o.key === "project:p1")).toMatchObject({
      areaKey: "area:a1",
      hint: "Pengelolaan BMN",
    });
    expect(options.projects.find((o) => o.key === "project:p2")).toMatchObject({
      hint: "Free Project",
      areaKey: undefined,
    });
    expect(options.loose.count).toBe(1);
    expect(scopeSummary([])).toBe("Semua cakupan");
    expect(scopeSummary(["area:a2"])).toBe("1 cakupan dikecualikan");
  });
});
