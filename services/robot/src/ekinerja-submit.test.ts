import { describe, expect, it } from "vitest";
import {
  incompleteRows,
  isSubmitButton,
  parseSubmitRequest,
  pickSubmitConfirm,
  rowDifference,
  submitOutcome,
} from "./ekinerja-submit.js";

describe("isSubmitButton", () => {
  it("mengenali teks tombol e-Kinerja (ikon di depan, ejaan Penilaiaan)", () => {
    expect(isSubmitButton(" Kirim Penilaiaan Ke Atasan")).toBe(true);
    expect(isSubmitButton("Kirim Penilaian ke Atasan")).toBe(true);
    expect(isSubmitButton(" Edit Rencana Aksi Kerja")).toBe(false);
    expect(isSubmitButton("Kirim Penilaian Ke Atasan sekarang juga")).toBe(false);
  });
});

describe("parseSubmitRequest", () => {
  it("wajib SKP, periode, isian; dryRun bawaan true", () => {
    expect(parseSubmitRequest({})).toEqual({ error: "Nomor SKP tidak valid." });
    expect(parseSubmitRequest({ skpExternalId: "1", period: "2026-13" })).toEqual({ error: "Periode tidak valid." });
    expect(parseSubmitRequest({ skpExternalId: "1", period: "2026-10" })).toEqual({
      error: "Isian Akasha bulan ini kosong.",
    });
    const ok = parseSubmitRequest({
      skpExternalId: "545406",
      period: "2026-10",
      expectedKeys: ["RHK A  Indikator B."],
    });
    expect(ok).toEqual({
      request: { skpExternalId: "545406", period: "2026-10", expectedKeys: ["rhk a indikator b"], dryRun: true },
    });
    const b = parseSubmitRequest({ skpExternalId: "1", period: "2026-10", expectedKeys: ["x"], dryRun: "false" });
    expect("request" in b && b.request.dryRun).toBe(true);
  });
});

describe("incompleteRows & rowDifference", () => {
  const rows = [
    { key: "a", renaksi: ["r"], realisasi: ["x"], bukti: ["https://b"] },
    { key: "b", renaksi: [], realisasi: ["x"], bukti: [] },
  ];
  it("baris kosong dilaporkan per bagian", () => {
    expect(incompleteRows(rows)).toEqual([{ key: "b", missing: ["Renaksi", "Bukti Data Dukung"] }]);
  });
  it("baris yang hanya ada di satu sisi", () => {
    expect(rowDifference(rows, ["a", "c"])).toEqual({ onlyEkinerja: ["b"], onlyAkasha: ["c"] });
    expect(rowDifference(rows, ["A", "b"])).toEqual({ onlyEkinerja: [], onlyAkasha: [] });
  });
});

describe("pickSubmitConfirm", () => {
  it("hanya dialog tentang mengirim penilaian + tombol setuju", () => {
    expect(pickSubmitConfirm("Kirim penilaian bulan ini ke atasan?", ["Batal", "Ya, Kirim"])).toBe("Ya, Kirim");
    expect(pickSubmitConfirm("Apakah anda yakin?", ["OK"])).toBeNull();
    // Dialog lain yang menyebut atasan tanpa kirim/ajukan (mis. memilih penilai) tidak pernah disetujui
    expect(pickSubmitConfirm("Pilih atasan penilai: A OK", ["OK"])).toBeNull();
    expect(pickSubmitConfirm("Ajukan penilaian bulan oktober ke atasan?", ["OK", "Batal"])).toBe("OK");
    expect(pickSubmitConfirm("Data akan dihapus", ["Ya"])).toBeNull();
    expect(pickSubmitConfirm("Ajukan penilaian?", ["Tidak", "Cancel"])).toBeNull();
  });
});

describe("submitOutcome", () => {
  it("berhasil / gagal / belum pasti", () => {
    expect(submitOutcome("Berhasil diajukan")).toBe("sent");
    expect(submitOutcome("Gagal mengirim, renaksi belum diisi")).toBe("failed");
    expect(submitOutcome("Memuat…")).toBe("unknown");
  });
});
