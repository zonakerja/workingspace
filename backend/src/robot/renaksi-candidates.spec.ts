import { describe, expect, it } from "vitest";
import {
  checkProposals,
  isExcluded,
  jakartaYmd,
  LOOSE_SCOPE,
  normalizeExcluded,
  renaksiCandidates,
  skpsForPeriod,
} from "./renaksi-candidates";

const data = {
  projects: [{ id: "p1", title: "Penyusunan Laporan BMN" }],
  activities: [
    { id: "sa", title: "Sub Area Aset" },
    { id: "k1", title: "Rekonsiliasi", parentId: "sa", deadline: "2026-10-20" },
    { id: "k2", title: "Bulan lain", parentId: "sa", deadline: "2026-09-20" },
  ],
  tasks: [
    {
      id: "t1",
      title: "Susun laporan",
      projectId: "p1",
      completed: true,
      completedAt: "2026-09-30T18:00:00.000Z", // 1 Okt WIB
      dueDate: "2026-09-29",
      resources: [{ name: "Laporan.pdf", uploadId: "u1" }],
    },
    { id: "t2", title: "Belum selesai", projectId: "p1", dueDate: "2026-10-05" },
    { id: "t3", title: "Selesai September", completed: true, completedAt: "2026-09-10T03:00:00.000Z" },
  ],
  schedules: [
    { id: "s1", title: "Rapat lintas bulan", startDate: "2026-09-29", endDate: "2026-10-02", outcome: "Notulen" },
    { id: "s2", title: "Rapat November", date: "2026-11-01" },
  ],
};

describe("kandidat renaksi dari Productivity", () => {
  it("tanggal selesai dibaca WIB", () => {
    expect(jakartaYmd("2026-09-30T18:00:00.000Z")).toBe("2026-10-01");
  });

  it("menarik task selesai/jatuh tempo, agenda yang beririsan, dan kegiatan bertenggat bulan itu", () => {
    const list = renaksiCandidates("2026-10", data);
    expect(list.map((c) => c.sourceId)).toEqual(["s1", "t1", "t2", "k1"]);
    const t1 = list.find((c) => c.sourceId === "t1")!;
    expect(t1).toMatchObject({ done: true, parentTitle: "Penyusunan Laporan BMN", date: "2026-10-01" });
    expect(t1.attachments).toEqual([{ name: "Laporan.pdf", uploadId: "u1", url: undefined }]);
    expect(list.find((c) => c.sourceId === "s1")).toMatchObject({ date: "2026-10-01", description: "Notulen" });
    expect(list.find((c) => c.sourceId === "k1")?.parentTitle).toBe("Sub Area Aset");
  });

  it("SKP dipilih menurut bulan", () => {
    const skps = [
      { id: "a", startDate: "2026-01-01", endDate: "2026-04-30" },
      { id: "b", startDate: "2026-05-01", endDate: "2026-12-31" },
    ];
    expect(skpsForPeriod(skps, "2026-10").map((s) => s.id)).toEqual(["b"]);
  });

  it("usulan diperiksa: kegiatan, RHK, keputusan pemilik, indikator", () => {
    const candidates = renaksiCandidates("2026-10", data);
    const targets = [{ id: "r1", indicators: [{ indicator: "Laporan" }, { indicator: "Waktu" }] }];
    const { ok, rejected } = checkProposals(
      [
        {
          sourceType: "task",
          sourceId: "t1",
          targetId: "r1",
          description: " Menyusun laporan ",
          indicators: ["Laporan"],
        },
        { sourceType: "task", sourceId: "t2", targetId: "r9", description: "x" },
        { sourceType: "task", sourceId: "t3", targetId: "r1", description: "x" },
        { sourceType: "schedule", sourceId: "s1", targetId: "r1", description: "Rapat" },
        {
          sourceType: "activity",
          sourceId: "k1",
          targetId: "r1",
          description: "Rekon",
          indicators: ["Laporan", "Waktu"],
        },
      ],
      candidates,
      targets,
      new Set(["s1"]),
    );
    expect(ok.map((o) => o.sourceId)).toEqual(["t1", "k1"]);
    expect(ok[0]).toMatchObject({ description: "Menyusun laporan", indicators: ["Laporan"] });
    expect(ok[1].indicators).toBeUndefined();
    expect(rejected.map((r) => r.sourceId)).toEqual(["t2", "t3", "s1"]);
  });
});

describe("cakupan kegiatan (filter Area / Project / Lepas)", () => {
  const scoped = {
    areas: [
      { id: "a1", title: "Pengelolaan BMN" },
      { id: "a2", title: "Pribadi" },
    ],
    projects: [
      { id: "p1", title: "Laporan BMN", areaId: "a1" },
      { id: "p2", title: "Proyek Bebas" },
    ],
    activities: [
      { id: "s1", title: "Sub Area", areaId: "a2" },
      { id: "k1", title: "Olahraga", areaId: "a2", parentId: "s1", deadline: "2026-10-03" },
    ],
    tasks: [
      { id: "t1", title: "Susun laporan", projectId: "p1", dueDate: "2026-10-05" },
      { id: "t2", title: "Tugas bebas", projectId: "p2", dueDate: "2026-10-06" },
      { id: "t3", title: "Tugas kegiatan", projectId: "k1", dueDate: "2026-10-07" },
    ],
    schedules: [{ id: "g1", title: "Rapat tanpa induk", date: "2026-10-08" }],
  };

  it("kunci cakupan: area + project, project bebas, item area, lepas", () => {
    const list = renaksiCandidates("2026-10", scoped);
    const scopeOf = (id: string) => list.find((c) => c.sourceId === id)!;
    expect(scopeOf("t1")).toMatchObject({
      scope: ["area:a1", "project:p1"],
      scopeLabel: "Pengelolaan BMN · Laporan BMN",
    });
    expect(scopeOf("t2").scope).toEqual(["project:p2"]);
    expect(scopeOf("t3").scope).toEqual(["area:a2"]);
    expect(scopeOf("k1").scope).toEqual(["area:a2"]);
    expect(scopeOf("g1")).toMatchObject({ scope: [LOOSE_SCOPE], scopeLabel: "Lepas" });
  });

  it("pengecualian: area menghapus semua isinya, project dalam area bisa dikecualikan sendiri", () => {
    const list = renaksiCandidates("2026-10", scoped);
    const kept = (excluded: string[]) => list.filter((c) => !isExcluded(c, excluded)).map((c) => c.sourceId);
    expect(kept(["area:a2"])).toEqual(["t1", "t2", "g1"]);
    expect(kept(["project:p1", LOOSE_SCOPE])).toEqual(["k1", "t2", "t3"]);
  });

  it("daftar pengecualian dibersihkan", () => {
    expect(normalizeExcluded(["area:a1", "area:a1", "loose", "hapus semua", 5, "project:"])).toEqual([
      "area:a1",
      "loose",
    ]);
    expect(normalizeExcluded("x")).toEqual([]);
  });
});
