import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { excelFormula, fileBase, sheetXlsxData } from "./artifact-export";
import { markdownToDocx } from "./markdown-docx";

describe("ekspor artifact", () => {
  it("rumus Excel: tanpa '=', titik koma → koma kecuali di dalam teks", () => {
    expect(excelFormula("=ROUND(AVERAGE(B2:B4);0)")).toBe("ROUND(AVERAGE(B2:B4),0)");
    expect(excelFormula('=IF(A1>0;"a;b";"c")')).toBe('IF(A1>0,"a;b","c")');
  });

  it("sel XLSX: judul tebal, angka ribuan berformat, persen, rumus, teks", () => {
    const data = sheetXlsxData([
      ["Uraian", "Harga", "Porsi", "Total"],
      ["ATK", "1500000", "15%", "=B2*C2"],
    ]);
    expect(data[0][0]).toMatchObject({ value: "Uraian", fontWeight: "bold" });
    expect(data[1][1]).toMatchObject({ value: 1500000, type: Number, format: "#,##0" });
    expect(data[1][2]).toMatchObject({ value: 0.15, format: "0%" });
    expect(data[1][3]).toMatchObject({ value: "B2*C2", type: "Formula" });
    expect(data[1][0]).toMatchObject({ value: "ATK", type: String });
  });

  it("nama berkas dari judul tanpa karakter terlarang", () => {
    expect(fileBase({ title: 'RAB: Rapat "Koordinasi"/2026', identifier: "rab" } as never)).toBe(
      "RAB- Rapat -Koordinasi-2026",
    );
  });

  it("Markdown → DOCX: judul, tebal, daftar bernomor, tabel, tautan aman saja", async () => {
    const blob = await markdownToDocx(
      "# Laporan\n\nTeks **penting** dan [situs](https://example.com) serta [jahat](javascript:alert(1)).\n\n1. Satu\n2. Dua\n\n| A | B |\n|---|--:|\n| x | 10 |\n\n- [x] selesai",
      "Laporan",
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("w:numId");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("☑ ");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com");
    expect(rels).not.toContain("javascript:");
  });
});
