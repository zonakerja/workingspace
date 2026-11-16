import { describe, expect, it, vi } from "vitest";
import { embedDocuments, embedQuery, textFormatOf } from "./embedding";

describe("embedding lewat Akai", () => {
  it("format teks mengikuti keluarga model", () => {
    expect(textFormatOf({ provider: "akai", model: "akai/gemini-embedding-2" })).toBe("gemini");
    expect(textFormatOf({ provider: "akai", model: "akai/text-embedding-3-small" })).toBe("openai");
    expect(textFormatOf({ provider: "gemini", model: "gemini-embedding-2" })).toBe("gemini");
  });

  it("memakai remote dan mencatat model yang menjawab", async () => {
    const remote = vi.fn(async (texts: string[]) => ({
      vectors: texts.map(() => [0.1]),
      model: "akai/cadangan",
    }));
    const target = { provider: "akai" as const, apiKey: "", model: "akai/gemini-embedding-2", remote };
    const docs = await embedDocuments(target, [{ title: "Judul", content: "isi" }]);
    expect(docs).toEqual({ vectors: [[0.1]], model: "akai/cadangan" });
    expect(remote.mock.calls[0][0][0]).toContain("title: Judul");
    const query = await embedQuery(target, "cari");
    expect(query.model).toBe("akai/cadangan");
    expect(remote.mock.calls[1][0][0]).toContain("query: cari");
  });

  it("tanpa teks tidak memanggil apa pun; tanpa remote = galat tidak tersedia", async () => {
    const remote = vi.fn();
    expect(await embedDocuments({ provider: "akai", apiKey: "", model: "akai/x", remote }, [])).toEqual({
      vectors: [],
      model: "akai/x",
    });
    expect(remote).not.toHaveBeenCalled();
    await expect(embedQuery({ provider: "akai", apiKey: "", model: "akai/x" }, "q")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
