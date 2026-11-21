import { describe, expect, it } from "vitest";
import {
  assetSummary,
  parseInfo,
  parseTotalRows,
  rowsToObjects,
  safeFileName,
  TICKET_PATTERN,
  toAsset,
} from "./siman-ticket.js";

describe("siman-ticket", () => {
  it("mengenali nomor tiket", () => {
    expect(TICKET_PATTERN.test("PPL26110408030558728")).toBe(true);
    expect(TICKET_PATTERN.test("PPL26-1")).toBe(false);
  });

  it("memasangkan label & nilai Informasi Umum, label ganda diberi akhiran", () => {
    const info = parseInfo([
      { kind: "label", text: "Nomor Tiket" },
      { kind: "value", text: "PPL26110408030558728" },
      { kind: "label", text: "Pemohon" },
      { kind: "value", text: "KANTOR UPBU KELAS III LETUNG" },
      { kind: "label", text: "Pemohon" },
      { kind: "value", text: "Satker" },
      { kind: "label", text: "Nilai Permohonan" },
      { kind: "value", text: "99.467.100" },
      { kind: "label", text: "Bukan label" },
      { kind: "value", text: "x" },
    ]);
    expect(info).toEqual({
      "Nomor Tiket": "PPL26110408030558728",
      Pemohon: "KANTOR UPBU KELAS III LETUNG",
      "Pemohon (2)": "Satker",
      "Nilai Permohonan": "99.467.100",
    });
  });

  it("baris tabel → aset, kolom Aksi dibuang, rupiah → angka", () => {
    const rows = rowsToObjects({
      headers: [
        "",
        "No",
        "Kode Barang",
        "NUP",
        "Nama Barang",
        "Kode Register",
        "Merk",
        "Tipe",
        "Tanggal Perolehan",
        "Nilai Perolehan",
        "Nilai Buku",
        "Nilai Permohonan",
        "Kondisi",
        "Aksi",
      ],
      rows: [
        [
          "",
          "1",
          "3050104002",
          "1",
          "Lemari Kayu",
          "5F5B",
          "Lemari Pakaian Kayu",
          "Lemari Pakaian Kayu",
          "11/08/2026",
          "Rp 1.720.500",
          "Rp 1.720.500",
          "Rp 1.720.500",
          "Baik",
          "",
        ],
      ],
    });
    expect(rows[0]).not.toHaveProperty("Aksi");
    const asset = toAsset(rows[0]);
    expect(asset).toMatchObject({ kodeBarang: "3050104002", nup: "1", nilaiPerolehan: 1720500, kondisi: "Baik" });
    expect(assetSummary([asset, asset], { "Nilai Permohonan": "3.441.000" })).toMatchObject({
      jumlah: 2,
      nilaiPermohonan: 3441000,
      cocokDenganKepala: true,
      kondisi: { Baik: 2 },
    });
  });

  it("membaca Total Rows dan merapikan nama berkas", () => {
    expect(parseTotalRows("Total Rows 1.501 Show 25")).toBe(1501);
    expect(parseTotalRows("tanpa")).toBeNull();
    expect(safeFileName("a/b:c.pdf", "x.pdf")).toBe("a-b-c.pdf");
    expect(safeFileName("  ", "x.pdf")).toBe("x.pdf");
  });
});
