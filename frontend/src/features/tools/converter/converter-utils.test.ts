import { describe, expect, it } from "vitest";
import { providerLabel, formatDuration, inboxTitle, markdownFileName, methodRows, tokenRows } from "./converter-utils";

describe("converter-utils", () => {
  it("names the downloaded file", () => {
    expect(markdownFileName("Laporan Tahunan.pdf")).toBe("Laporan Tahunan.md");
    expect(markdownFileName("a/b.docx")).toBe("a_b.md");
    expect(markdownFileName(".pdf")).toBe("hasil-konversi.md");
  });

  it("builds an inbox title", () => {
    expect(inboxTitle("SK Panitia.docx")).toBe("SK Panitia");
    expect(inboxTitle("x".repeat(200) + ".pdf")).toHaveLength(120);
  });

  it("labels the provider that enhanced the markdown", () => {
    expect(providerLabel("anthropic")).toBe("Claude");
    expect(providerLabel("gemini")).toBe("Gemini");
    expect(providerLabel(null)).toBe("AI");
  });

  it("formats durations", () => {
    expect(formatDuration(40)).toBe("40 ms");
    expect(formatDuration(1850)).toBe("1,9 dtk");
    expect(formatDuration(65_000)).toBe("1 mnt 5 dtk");
    expect(formatDuration(120_000)).toBe("2 mnt");
  });

  it("builds token comparison rows with savings against the raw file", () => {
    const rows = tokenRows({
      available: true,
      model: "gemini",
      rawFile: 1000,
      rawFileNote: null,
      markdown: 250,
      enhance: { input: 400, output: 240, result: 240 },
    });
    expect(rows.map((r) => [r.tokens, r.saving])).toEqual([
      [1000, null],
      [250, 75],
      [240, 76],
      [640, null],
    ]);
    const docx = tokenRows({
      available: true,
      model: "g",
      rawFile: null,
      rawFileNote: "x",
      markdown: 10,
      enhance: null,
    });
    expect(docx[1].saving).toBeNull();
  });

  it("sorts method rows and marks AI OCR as paid", () => {
    expect(methodRows({ pdf: 2, docling: 5, ocr: 1, zzz: 0 })).toEqual([
      { method: "docling", label: "Docling (OCR lokal)", count: 5, free: true },
      { method: "pdf", label: "Pembaca PDF bawaan", count: 2, free: true },
      { method: "ocr", label: "OCR AI (memakai token)", count: 1, free: false },
    ]);
  });
});
