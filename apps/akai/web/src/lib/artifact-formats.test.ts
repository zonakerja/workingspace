import { describe, expect, it } from "vitest";
import {
  cellRef,
  columnName,
  computeSheet,
  evaluateFormula,
  exportFormats,
  parseCsv,
  parseSheet,
  parseSlides,
  parseWhiteboard,
  sheetCell,
  svgSize,
  toCsv,
  whiteboardSvg,
  wrapText,
} from "./artifact-formats";
import { parseArtifacts } from "./artifacts";

describe("lembar kerja", () => {
  it("CSV: kutip, koma & baris baru di dalam kutip, kutip ganda", () => {
    expect(parseCsv('Nama,Catatan\n"Budi, S.T.","baris 1\nbaris 2"\n"Ia berkata ""ya""",x')).toEqual([
      ["Nama", "Catatan"],
      ["Budi, S.T.", "baris 1\nbaris 2"],
      ['Ia berkata "ya"', "x"],
    ]);
  });

  it("pemisah titik koma & tab dikenali, baris kosong dibuang", () => {
    expect(parseCsv("a;b\n1;2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("beberapa lembar & baris dirapikan sama lebar", () => {
    const sheets = parseSheet("# Sheet: Anggaran\nUraian,Biaya\nATK,500000\n# Sheet: Ringkas\nTotal\n=SUM(1,2)");
    expect(sheets.map((s) => s.name)).toEqual(["Anggaran", "Ringkas"]);
    expect(parseSheet("a,b,c\n1")[0].rows[1]).toEqual(["1", "", ""]);
  });

  it("jenis sel: angka, persen, rumus, teks (kode berawalan 0 tetap teks)", () => {
    expect(sheetCell("1500000")).toEqual({ kind: "number", value: 1500000 });
    expect(sheetCell("12.5%")).toEqual({ kind: "number", value: 0.125, percent: true });
    expect(sheetCell("=SUM(B2:B4)")).toEqual({ kind: "formula", formula: "=SUM(B2:B4)" });
    expect(sheetCell("0812345")).toEqual({ kind: "text", text: "0812345" });
    expect(sheetCell(" ")).toEqual({ kind: "empty" });
  });

  it("alamat sel & nama kolom", () => {
    expect(cellRef("B12")).toEqual({ col: 1, row: 11 });
    expect(cellRef("AA1")).toEqual({ col: 26, row: 0 });
    expect(columnName(0)).toBe("A");
    expect(columnName(27)).toBe("AB");
  });

  it("rumus: aritmetika, fungsi, rentang, rumus berantai, rujukan melingkar", () => {
    const grid = computeSheet([
      ["Uraian", "Jumlah", "Harga", "Total"],
      ["ATK", "2", "1500", "=B2*C2"],
      ["Konsumsi", "10", "25000", "=B3*C3"],
      ["Total", "", "", "=SUM(D2:D3)"],
      ["Rata", "", "", "=ROUND(AVERAGE(D2:D3);0)"],
      ["Siklus", "", "", "=D6+1"],
      ["Tak dikenal", "", "", "=VLOOKUP(A2,A1:D3,2)"],
    ]);
    expect(grid[1][3].numeric).toBe(3000);
    expect(grid[3][3].numeric).toBe(253000);
    expect(grid[4][3].numeric).toBe(126500);
    expect(grid[5][3]).toMatchObject({ numeric: null, display: "=D6+1" });
    expect(grid[6][3].numeric).toBeNull();
    expect(evaluateFormula("=(2+3)*-2/4", () => null)).toBe(-2.5);
    expect(evaluateFormula("=1/0", () => null)).toBeNull();
  });

  it("kembali ke CSV dengan kutip seperlunya", () => {
    expect(toCsv([["a,b", 'c"d', "e"]])).toBe('"a,b","c""d",e');
  });
});

describe("slide", () => {
  it("pemisah ---, slide judul, catatan pembicara, --- di blok kode diabaikan", () => {
    const slides = parseSlides(
      "# Rapat Evaluasi\nTriwulan III\n---\n## Capaian\n- 80% target\n- Anggaran aman\nCatatan: tekankan anggaran\nbaris kedua\n---\n## Kode\n```\n---\n```",
    );
    expect(slides).toHaveLength(3);
    expect(slides[0]).toMatchObject({ title: "Rapat Evaluasi", cover: true, body: "Triwulan III" });
    expect(slides[1]).toMatchObject({
      title: "Capaian",
      cover: false,
      body: "- 80% target\n- Anggaran aman",
      notes: "tekankan anggaran\nbaris kedua",
    });
    expect(slides[2].body).toContain("---");
  });

  it("slide kosong dibuang; heading ## di slide pertama bukan slide judul", () => {
    const slides = parseSlides("## Agenda\n- a\n---\n\n---\n## Penutup");
    expect(slides.map((s) => s.title)).toEqual(["Agenda", "Penutup"]);
    expect(slides[0].cover).toBe(false);
  });
});

describe("papan tulis", () => {
  const board = JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "# Ide\nPerbaiki **layanan**", x: 0, y: 0, width: 240, height: 120, color: "4" },
      { id: "b", type: "text", text: "Tindak lanjut <script>", x: 400, y: 0, width: 240, height: 120 },
      { id: "g", type: "group", label: "Kelompok", x: -20, y: -40, width: 700, height: 200 },
      { id: "a", type: "text", text: "ganda", x: 0, y: 0 },
      { id: "c", type: "file", file: "Catatan/Rapat.md", x: 0, y: 300, color: "javascript:x" },
    ],
    edges: [
      { id: "e1", fromNode: "a", toNode: "b", label: "lalu" },
      { id: "e2", fromNode: "a", toNode: "hilang" },
    ],
  });

  it("node ganda & garis ke node yang tidak ada dibuang, warna tidak sah dibuang", () => {
    const { board: b } = parseWhiteboard(board);
    expect(b!.nodes.map((n) => n.id)).toEqual(["a", "b", "g", "c"]);
    expect(b!.nodes[3]).toMatchObject({ type: "text", text: "Catatan/Rapat.md", color: undefined });
    expect(b!.edges).toHaveLength(1);
  });

  it("JSON rusak / tanpa node = pesan galat", () => {
    expect(parseWhiteboard("{oops").error).toBeTruthy();
    expect(parseWhiteboard('{"nodes":[]}').error).toBe("Papan masih kosong.");
  });

  it("SVG: teks di-escape, label garis tampil, tanpa skrip", () => {
    const { svg, width, height } = whiteboardSvg(parseWhiteboard(board).board!);
    expect(svg).toContain("Tindak lanjut &lt;script&gt;");
    expect(svg).toContain(">lalu<");
    expect(svg).not.toMatch(/<script/i);
    expect(width).toBeGreaterThan(700);
    expect(height).toBeGreaterThan(300);
  });

  it("teks kartu dipecah per baris, Markdown ringan dibuang", () => {
    const lines = wrapText("# Judul\nsatu dua tiga empat lima enam", 100, 14);
    expect(lines[0]).toEqual({ text: "Judul", bold: true });
    expect(lines.slice(1).every((l) => l.text.length <= 12)).toBe(true);
  });
});

describe("ukuran SVG & pilihan ekspor", () => {
  it("width/height, viewBox, persen diabaikan", () => {
    expect(svgSize('<svg width="1080" height="1350">')).toEqual({ width: 1080, height: 1350 });
    expect(svgSize('<svg viewBox="0 0 800 400" width="100%">')).toEqual({ width: 800, height: 400 });
    expect(svgSize('<svg width="400" viewBox="0 0 800 200">')).toEqual({ width: 400, height: 100 });
    expect(svgSize("<svg>")).toEqual({ width: 1024, height: 768 });
  });

  it("format ekspor per jenis", () => {
    expect(exportFormats("markdown")[0]).toBe("docx");
    expect(exportFormats("sheet")).toContain("xlsx");
    expect(exportFormats("slides")[0]).toBe("pptx");
    expect(exportFormats("whiteboard")).toEqual(["png", "svg", "pdf", "canvas"]);
    expect(exportFormats("code")).toEqual(["source"]);
  });

  it("jenis artifact baru dikenali dari tag", () => {
    const segs = parseArtifacts(
      '<akai_artifact identifier="rab" type="sheet" title="RAB">\na,b\n1,2\n</akai_artifact>',
    );
    expect(segs[0]).toMatchObject({ kind: "artifact", artifact: { type: "sheet" } });
  });
});
