import { describe, expect, it } from "vitest";
import {
  fillRequestTitle,
  fillSnapshot,
  isPeriod,
  isYear,
  renaksiRunInput,
  summarizeCheck,
  summarizeTask,
} from "./ekinerja-agent-logic";

describe("robot e-Kinerja untuk agen", () => {
  it("bulan & tahun divalidasi", () => {
    expect(isPeriod("2026-10")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("26-10")).toBe(false);
    expect(isPeriod(202610)).toBe(false);
    expect(isYear(2026)).toBe(true);
    expect(isYear(2026.5)).toBe(false);
    expect(isYear(1999)).toBe(false);
  });

  it("judul permintaan memakai nama bulan Indonesia", () => {
    expect(fillRequestTitle("2026-10")).toBe("Isi Rencana Aksi e-Kinerja Oktober 2026");
  });

  it("potret pengisian hanya bulan yang diminta, hapus tertunda dihitung", () => {
    const snap = fillSnapshot(
      [
        { period: "2026-10", description: "Menyusun laporan", status: "ready" },
        { period: "2026-10", description: "Rapat", deleted: true },
        { period: "2026-09", description: "Bulan lain" },
      ],
      "2026-10",
    );
    expect(snap.total).toBe(2);
    expect(snap.deleted).toBe(1);
    expect(snap.entries.map((e) => e.description)).toEqual(["Menyusun laporan", "Rapat"]);
  });

  it("hasil periksa diringkas, bulan diajukan diberi keterangan terkunci", () => {
    const summary = summarizeCheck({
      period: "2026-10",
      imported: 1,
      results: [{ skp: "123", status: "submitted", missing: [], rows: [] }],
    });
    expect(summary.bulan).toBe("Oktober 2026");
    expect(summary.skp[0].status_bulan).toContain("terkunci");
    expect(summarizeTask("check", { results: [{ skp: "1", status: "submitted" }] })).toContain("1 bulan terkunci");
  });

  it("ringkasan Ambil SKP & Pantau", () => {
    expect(summarizeTask("skp", { year: 2026, skps: 2, rhk: 5 })).toBe("SKP 2026: 2 SKP, 5 RHK");
    expect(summarizeTask("monitor", { months: [1, 2], skps: 1, imported: 0 })).toContain("2 bulan");
  });
});

describe("perintah Hermes usulan renaksi", () => {
  it("menyebut skill, bulan, alat usulan, dan larangan mengisi", () => {
    const input = renaksiRunInput("2026-10");
    expect(input).toContain("renaksi-ekinerja");
    expect(input).toContain("Oktober 2026");
    expect(input).toContain("ekinerja_propose_renaksi");
    expect(input).toContain("Jangan memanggil ekinerja_request_fill");
  });

  it("potret pengisian mengabaikan usulan agen", () => {
    expect(fillSnapshot([{ period: "2026-10", description: "Usulan", proposed: true }], "2026-10").total).toBe(0);
  });
});
