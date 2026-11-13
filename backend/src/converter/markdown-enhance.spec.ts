import { describe, expect, it } from "vitest";
import {
  boilerplateLines,
  buildEnhancePrompt,
  checkEnhanced,
  cleanEnhanceOutput,
  shouldEnhance,
  splitForEnhance,
} from "./markdown-enhance";

describe("markdown-enhance", () => {
  it("keeps short documents in one part", () => {
    expect(splitForEnhance("# A\n\nIsi.\n\n## B\n\nLagi.", 1000)).toEqual(["# A\n\nIsi.\n\n## B\n\nLagi."]);
  });

  it("splits long documents at headings and never inside a table", () => {
    const table = ["| a | b |", "|---|---|", ...Array.from({ length: 30 }, (_, i) => `| ${i} | x |`)].join("\n");
    const doc = `# Bab 1\n\n${"Kalimat pertama. ".repeat(20)}\n\n${table}\n\n# Bab 2\n\n${"Isi bab dua. ".repeat(20)}`;
    const parts = splitForEnhance(doc, 400);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("\n\n").replace(/\s/g, "")).toBe(doc.replace(/\s/g, ""));
    expect(parts.some((p) => p.includes("| 0 | x |") && p.includes("| 29 | x |"))).toBe(true);
    expect(parts.find((p) => p.includes("# Bab 2"))?.startsWith("# Bab 2")).toBe(true);
  });

  it("cuts a giant OCR paragraph at sentence ends", () => {
    const parts = splitForEnhance("Satu dua tiga. ".repeat(200), 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts[0].endsWith(".")).toBe(true);
  });

  it("builds a strict prompt", () => {
    const prompt = buildEnhancePrompt("isi", { fileName: "SK.pdf", engine: "docling", part: 1, parts: 2 });
    expect(prompt).toContain("lewat OCR");
    expect(prompt).toContain("DILARANG");
    expect(prompt).toContain("<markdown>\nisi\n</markdown>");
  });

  it("cleans wrappers from model output", () => {
    expect(cleanEnhanceOutput("```markdown\n# A\n```")).toBe("# A");
    expect(cleanEnhanceOutput("Berikut hasil rapikan:\n\n# A")).toBe("# A");
    expect(cleanEnhanceOutput("<markdown>\n# A\n</markdown>")).toBe("# A");
  });

  it("accepts structural fixes and rejects summaries or changed numbers", () => {
    const original = "KEPUTUSAN Nornor 12/KEU/2026 tentang penge- lolaan barang milik negara senilai Rp 250.000.000";
    expect(
      checkEnhanced(
        original,
        "# KEPUTUSAN\n\nNomor 12/KEU/2026 tentang pengelolaan barang milik negara senilai Rp 250.000.000",
      ).ok,
    ).toBe(true);
    expect(checkEnhanced(original, "Keputusan tentang BMN.").ok).toBe(false);
    expect(
      checkEnhanced(
        original,
        "KEPUTUSAN Nomor 13/KEU/2026 tentang pengelolaan barang milik negara senilai Rp 260.000.000",
      ).reason,
    ).toMatch(/^angka\/nomor berubah \(hilang: \d/);
    expect(checkEnhanced(original, "").ok).toBe(false);
  });

  it("compares digit runs so spacing fixes in numbers are accepted", () => {
    const original = "Nomor 553.2/ P270726-5. 696 /DISHUB-III tanggal 27 Juli 2026\n![ikon](A2_ikon111.jpg)";
    expect(checkEnhanced(original, "Nomor 553.2/P270726-5.696/DISHUB-III tanggal 27 Juli 2026").ok).toBe(true);
    expect(checkEnhanced(original, "Nomor 553.2/P270727-5.696/DISHUB-III tanggal 27 Juli 2026").ok).toBe(false);
  });

  it("allows the model to drop repeated page headers and page numbers", () => {
    const doc = Array.from(
      { length: 4 },
      (_, i) => `2021, No.1146\n-${i + 2}-\nPasal ${i + 1} berlaku sejak 2021.`,
    ).join("\n");
    const boilerplate = boilerplateLines(doc);
    expect(boilerplate.has("2021, No.1146")).toBe(true);
    const cleaned = Array.from({ length: 4 }, (_, i) => `Pasal ${i + 1} berlaku sejak 2021.`).join("\n\n");
    expect(checkEnhanced(doc, cleaned).ok).toBe(false);
    expect(checkEnhanced(doc, cleaned, boilerplate).ok).toBe(true);
  });

  it("enhances OCR results only unless scope is all", () => {
    expect(shouldEnhance("ocr", "docling")).toBe(true);
    expect(shouldEnhance("ocr", "markitdown")).toBe(false);
    expect(shouldEnhance("all", "markitdown")).toBe(true);
  });
});
