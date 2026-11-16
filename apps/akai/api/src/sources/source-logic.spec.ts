import { describe, expect, it } from "vitest";
import { keyHint, normalizeBaseUrl, parseCatalog } from "./source-logic";

describe("normalizeBaseUrl", () => {
  it("menerima https & membuang garis miring akhir", () => {
    expect(normalizeBaseUrl("https://router.classai.id/v1/", true)).toEqual({
      ok: true,
      url: "https://router.classai.id/v1",
    });
  });
  it("http lokal hanya di luar production", () => {
    expect(normalizeBaseUrl("http://localhost:9999/v1", false).ok).toBe(true);
    expect(normalizeBaseUrl("http://localhost:9999/v1", true).ok).toBe(false);
    expect(normalizeBaseUrl("https://10.0.0.5/v1", true).ok).toBe(false);
    expect(normalizeBaseUrl("http://router.example.com/v1", false).ok).toBe(false);
  });
  it("menolak kredensial & query", () => {
    expect(normalizeBaseUrl("https://a:b@x.com/v1", false).ok).toBe(false);
    expect(normalizeBaseUrl("https://x.com/v1?k=1", false).ok).toBe(false);
  });
});

describe("keyHint", () => {
  it("4 karakter terakhir untuk key panjang", () => {
    expect(keyHint("sk-1234567890abcd")).toBe("abcd");
    expect(keyHint("pendek")).toBe("");
  });
});

describe("parseCatalog", () => {
  it("membaca format OpenRouter (harga per token → per 1 jt token)", () => {
    const entries = parseCatalog({
      data: [
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          context_length: 128000,
          pricing: { prompt: "0.00000027", completion: "0.0000011" },
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["tools", "temperature"],
        },
      ],
    });
    expect(entries).toEqual([
      {
        modelId: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextLength: 128000,
        priceIn: 0.27,
        priceOut: 1.1,
        currency: "USD",
        vision: true,
        tools: true,
        embedding: false,
      },
    ]);
  });
  it("format tanpa harga (Classai, Anthropic) & buang duplikat / id kosong", () => {
    const entries = parseCatalog({
      data: [
        { id: "kimi-k3" },
        { id: "kimi-k3" },
        { id: "" },
        { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
        { id: "text-embedding-4" },
      ],
    });
    expect(entries.map((e) => e.modelId)).toEqual(["claude-opus-5-5", "kimi-k3", "text-embedding-4"]);
    expect(entries[0]).toMatchObject({ name: "Claude Opus 5.5", priceIn: null, currency: null });
    expect(entries[2].embedding).toBe(true);
  });
  it("bentuk tidak dikenal → kosong", () => {
    expect(parseCatalog({ models: [] })).toEqual([]);
    expect(parseCatalog(null)).toEqual([]);
  });
});
