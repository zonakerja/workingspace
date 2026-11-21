import { describe, expect, it } from "vitest";
import { checkSkillChange, lineChangeCount, skillFrontmatter } from "./skill-change";

const body = `---
name: verifikasi-tte
description: Verifikasi tanda tangan elektronik PDF.
---

# Verifikasi TTE

Langkah kerja yang cukup panjang untuk lolos batas minimal isi.
`;

describe("skill change", () => {
  it("parses frontmatter", () => {
    expect(skillFrontmatter(body)).toEqual({
      name: "verifikasi-tte",
      description: "Verifikasi tanda tangan elektronik PDF.",
    });
    expect(skillFrontmatter("# tanpa frontmatter")).toBeNull();
  });

  it("validates a proposal", () => {
    const ok = checkSkillChange({ skill: "verifikasi-tte", content: body, summary: "Tambah langkah LTV" });
    expect("error" in ok).toBe(false);
    expect(checkSkillChange({ skill: "Verifikasi TTE", content: body, summary: "x x x x" })).toHaveProperty("error");
    expect(checkSkillChange({ skill: "lain", content: body, summary: "Tambah langkah" })).toHaveProperty("error");
    expect(checkSkillChange({ skill: "verifikasi-tte", content: body, summary: "" })).toHaveProperty("error");
    expect(checkSkillChange({ skill: "../etc", content: body, summary: "Tambah langkah" })).toHaveProperty("error");
  });

  it("counts changed lines", () => {
    expect(lineChangeCount("a\nb\nc", "a\nc\nd\ne")).toEqual({ added: 2, removed: 1 });
  });
});
