import { describe, expect, it } from "vitest";
import {
  documentResult,
  filterDocuments,
  formatSize,
  providerLabel,
  formatDuration,
  inboxTitle,
  markdownFileName,
  methodRows,
  tokenRows,
} from "./converter-utils";

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

  it("maps a stored document to a conversion result", () => {
    const base = {
      id: "d1",
      title: "SK",
      fileName: "sk.docx",
      mimeType: "x",
      size: 10,
      options: {},
      error: null,
      createdAt: "",
      updatedAt: "",
      finishedAt: null,
      summary: { pages: null, tokens: 5, durationMs: 1, enhanced: true, enhanceError: null },
    };
    const result = {
      reason: "r",
      fallbackFrom: null,
      pages: null,
      chars: 3,
      rawChars: 3,
      tokens: 5,
      warnings: [],
      durationMs: 1,
      fileName: "sk.docx",
      size: 10,
      enhanceError: null,
      tokenComparison: null,
      enhanced: {
        parts: 1,
        rejected: 0,
        failed: 0,
        inputTokens: 1,
        outputTokens: 1,
        provider: "anthropic",
        model: null,
        durationMs: 1,
        notes: [],
      },
    };
    const doc = {
      ...base,
      status: "done" as const,
      engine: "markitdown" as const,
      markdown: "a",
      enhancedMarkdown: "b",
      result,
    };
    expect(documentResult(doc)?.markdown).toBe("a");
    expect(documentResult(doc)?.enhanced?.markdown).toBe("b");
    expect(documentResult({ ...doc, enhancedMarkdown: null })?.enhanced).toBeNull();
    expect(documentResult({ ...doc, status: "processing" })).toBeNull();
  });

  it("filters documents by every word and formats sizes", () => {
    const docs = [
      { title: "SK Panitia", fileName: "a.docx" },
      { title: "Risalah", fileName: "rapat-ksp.pdf" },
    ];
    expect(filterDocuments(docs, "panitia sk")).toHaveLength(1);
    expect(filterDocuments(docs, "KSP")[0].title).toBe("Risalah");
    expect(filterDocuments(docs, " ")).toHaveLength(2);
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(1536)).toBe("1,5 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});
