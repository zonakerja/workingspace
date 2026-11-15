import { describe, expect, it } from "vitest";
import type { ActionPlanEntry, Skp, SkpTarget } from "@/types/entities";
import { copiedEntry, copyCandidates } from "./copy-month";

const skps = [
  { id: "s1", startDate: "2026-01-01", endDate: "2026-04-30" },
  { id: "s2", startDate: "2026-05-01", endDate: "2026-12-31" },
] as Skp[];
const targets = [
  { id: "r1", year: 2026, skpId: "s1", name: "Laporan BMN", section: "UTAMA", indicators: [{ indicator: "Jumlah" }] },
  {
    id: "r2",
    year: 2026,
    skpId: "s2",
    name: "Laporan  BMN",
    section: "UTAMA",
    indicators: [{ indicator: "Jumlah" }, { indicator: "Waktu" }],
  },
  { id: "r3", year: 2026, skpId: "s2", name: "Rapat koordinasi", indicators: [{ indicator: "Jumlah" }] },
] as SkpTarget[];

const entry = (over: Partial<ActionPlanEntry>): ActionPlanEntry => ({
  id: over.id ?? "e",
  period: "2026-10",
  description: "x",
  status: "filled",
  ...over,
});

describe("salin butir dari bulan lalu", () => {
  it("RHK sama tetap, butir terhapus/usulan dilewati, butir yang sudah ada ditandai", () => {
    const entries = [
      entry({ id: "a", targetId: "r3", description: "Rapat koordinasi bulanan", documentUrl: "https://bukti" }),
      entry({ id: "b", targetId: "r3", description: "Dihapus", deleted: true }),
      entry({ id: "c", targetId: "r3", description: "Usulan", proposed: true }),
      entry({ id: "d", period: "2026-11", targetId: "r3", description: "rapat  koordinasi BULANAN", status: "draft" }),
      entry({ id: "e2", targetId: "r3", description: "Notulen rapat" }),
    ];
    const list = copyCandidates(entries, targets, skps, "2026-11");
    expect(list.map((c) => [c.entry.id, c.targetId, c.exists])).toEqual([
      ["a", "r3", true],
      ["e2", "r3", false],
    ]);
  });

  it("SKP berganti: RHK dipetakan lewat nama & bagian, indikator yang hilang dibuang", () => {
    const list = copyCandidates(
      [
        entry({
          id: "a",
          period: "2026-04",
          targetId: "r1",
          description: "Susun laporan",
          indicators: ["Jumlah", "Lama"],
        }),
      ],
      targets,
      skps,
      "2026-05",
    );
    expect(list[0]).toMatchObject({ targetId: "r2", skpId: "s2", indicators: ["Jumlah"], exists: false });
  });

  it("salinan tanpa bukti & tanpa riwayat kirim, status draf", () => {
    const [c] = copyCandidates(
      [
        entry({
          id: "a",
          targetId: "r3",
          description: "Rapat",
          realization: "Notulen",
          documentUrl: "https://bukti",
          vaultId: "v1",
          pushedSignature: "sig",
        }),
      ],
      targets,
      skps,
      "2026-11",
    );
    const copy = copiedEntry(c, "2026-11", "baru", "2026-11-12T00:00:00.000Z");
    expect(copy).toMatchObject({
      id: "baru",
      period: "2026-11",
      targetId: "r3",
      skpId: "s2",
      realization: "Notulen",
      status: "draft",
    });
    expect(copy.documentUrl).toBeUndefined();
    expect(copy.vaultId).toBeUndefined();
    expect(copy.pushedSignature).toBeUndefined();
  });
});
