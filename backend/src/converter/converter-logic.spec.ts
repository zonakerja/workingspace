import { describe, expect, it } from "vitest";
import {
  libraryTitle,
  librarySummary,
  converterExtension,
  converterHandles,
  DEFAULT_CONVERTER_PREFS,
  estimateTokens,
  isOcrCandidate,
  needsReconvert,
  normalizeConverterPrefs,
} from "./converter-logic";

describe("converter-logic", () => {
  it("normalizes preferences", () => {
    expect(normalizeConverterPrefs(null)).toEqual(DEFAULT_CONVERTER_PREFS);
    expect(
      normalizeConverterPrefs({ enabled: false, pdfMode: "docling", aiOcrFallback: false, aiEnhance: true, x: 1 }),
    ).toEqual({ enabled: false, pdfMode: "docling", aiOcrFallback: false, aiEnhance: true, aiEnhanceScope: "ocr" });
    expect(normalizeConverterPrefs({ pdfMode: "ocr", enabled: "ya" })).toEqual(DEFAULT_CONVERTER_PREFS);
  });

  it("chooses which files go to the converter", () => {
    expect(converterHandles("application/pdf", "Laporan.PDF")).toBe(true);
    expect(converterHandles("application/octet-stream", "data.xls")).toBe(true);
    expect(converterHandles("image/png", "foto")).toBe(true);
    expect(converterHandles("text/plain", "catatan.txt")).toBe(false);
    expect(converterHandles("text/csv", "data.csv")).toBe(false);
    expect(converterHandles("application/zip", "arsip.zip")).toBe(false);
    expect(converterExtension("image/jpeg", "C:\\foto\\scan")).toBe("jpg");
  });

  it("marks scans and images as OCR candidates", () => {
    expect(isOcrCandidate("application/pdf", "a.pdf")).toBe(true);
    expect(isOcrCandidate("image/webp", "a.webp")).toBe(true);
    expect(isOcrCandidate("application/vnd.ms-excel", "a.xls")).toBe(false);
  });

  it("selects files for reconversion", () => {
    expect(needsReconvert(null, "legacy")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "ocr" }, "ai_ocr")).toBe(true);
    expect(needsReconvert({ status: "completed", method: "pdf" }, "ai_ocr")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "docling" }, "legacy")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "docx" }, "legacy")).toBe(true);
    expect(needsReconvert({ status: "unsupported" }, "missing")).toBe(true);
    expect(needsReconvert({ status: "completed", method: "pdf" }, "missing")).toBe(false);
    expect(needsReconvert({ status: "extracting" }, "legacy")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "docling" }, "unenhanced")).toBe(true);
    expect(needsReconvert({ status: "completed", method: "docling", enhanced: true }, "unenhanced")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "markitdown" }, "unenhanced")).toBe(false);
    expect(needsReconvert({ status: "completed", method: "markitdown" }, "unenhanced", "all")).toBe(true);
    expect(needsReconvert({ status: "completed", method: "pdf" }, "unenhanced", "all")).toBe(false);
  });

  it("estimates tokens", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("titles library documents from the file name", () => {
    expect(libraryTitle("SK  Panitia Penghapusan.docx")).toBe("SK Panitia Penghapusan");
    expect(libraryTitle(".pdf")).toBe("Hasil konversi");
    expect(libraryTitle("x".repeat(300) + ".pdf")).toHaveLength(200);
  });

  it("summarizes stored results without markdown", () => {
    expect(librarySummary(null)).toEqual({
      pages: null,
      tokens: null,
      durationMs: null,
      enhanced: false,
      enhanceError: null,
    });
    expect(
      librarySummary({
        pages: 3,
        tokens: 900,
        durationMs: 1200,
        enhanced: { parts: 1 },
        enhanceError: null,
        markdown: "x",
      }),
    ).toEqual({ pages: 3, tokens: 900, durationMs: 1200, enhanced: true, enhanceError: null });
  });
});
