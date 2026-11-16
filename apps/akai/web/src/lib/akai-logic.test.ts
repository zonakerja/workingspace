import { describe, expect, it } from "vitest";
import { formatCost, formatPrice, formatTokens, matchesQuery, modelFitsTask, moveItem } from "./akai-logic";

const model = (over: Partial<Parameters<typeof modelFitsTask>[1]> = {}) => ({
  enabled: true,
  embedding: false,
  vision: false,
  audio: false,
  source: { label: "x", kind: "router" as const },
  ...over,
});

describe("akai-logic", () => {
  it("model cocok tugas", () => {
    expect(modelFitsTask("chat", model())).toBe(true);
    expect(modelFitsTask("chat", model({ enabled: false }))).toBe(false);
    expect(modelFitsTask("chat", model({ embedding: true }))).toBe(false);
    expect(modelFitsTask("embedding", model({ embedding: true }))).toBe(true);
    expect(modelFitsTask("ocr", model())).toBe(false);
    expect(modelFitsTask("ocr", model({ vision: true }))).toBe(true);
    expect(modelFitsTask("transcribe", model({ audio: true }))).toBe(false);
    expect(modelFitsTask("transcribe", model({ audio: true, source: { label: "g", kind: "gemini" } }))).toBe(true);
  });

  it("urutan cadangan", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  it("format angka", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12,3 rb");
    expect(formatTokens(1_250_000)).toBe("1,3 jt");
    expect(formatCost({})).toBe("—");
    expect(formatCost({ USD: 0.42 })).toContain("0,42");
    expect(formatPrice(null, null, null)).toBe("—");
    expect(formatPrice(0.27, 1.1, "USD")).toBe("0,27 / 1,1");
    expect(matchesQuery("deepseek/deepseek-v4-flash DeepSeek V4", "deepseek flash")).toBe(true);
    expect(matchesQuery("gpt-6", "claude")).toBe(false);
  });
});
