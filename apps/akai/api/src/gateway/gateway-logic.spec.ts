import { describe, expect, it } from "vitest";
import {
  callerStatus,
  estimateCost,
  isFallbackStatus,
  needsPdf,
  needsTools,
  needsVision,
  upstreamMessage,
  usageFromOpenAi,
} from "./gateway-logic";

describe("isFallbackStatus & callerStatus", () => {
  it("kuota, waktu habis, server galat → cadangan", () => {
    for (const s of [429, 402, 408, 500, 502, 503, 529]) expect(isFallbackStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isFallbackStatus(s)).toBe(false);
  });
  it("ke aplikasi hanya 429 atau 422", () => {
    expect(callerStatus(429)).toBe(429);
    expect(callerStatus(402)).toBe(429);
    for (const s of [401, 403, 404, 500, 503]) expect(callerStatus(s)).toBe(422);
  });
});

describe("needsVision & needsTools", () => {
  it("mengenali gambar & alat", () => {
    expect(needsVision([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:," } }] }])).toBe(true);
    expect(needsVision([{ role: "user", content: "hai" }])).toBe(false);
    expect(needsTools({ tools: [{ type: "function" }] })).toBe(true);
    expect(needsTools({})).toBe(false);
    expect(
      needsPdf([{ role: "user", content: [{ type: "file", file: { file_data: "data:application/pdf;base64,AA" } }] }]),
    ).toBe(true);
    expect(needsPdf([{ role: "user", content: [{ type: "text", text: "x" }] }])).toBe(false);
  });
});

describe("usage & biaya", () => {
  it("membaca usage OpenAI", () => {
    expect(
      usageFromOpenAi({ prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } }),
    ).toEqual({ input: 1000, output: 200, cached: 400 });
    expect(usageFromOpenAi(null)).toEqual({ input: null, output: null, cached: null });
  });
  it("biaya per 1 jt token, cache setengah harga, paket = 0, tanpa harga = null", () => {
    const usage = { input: 1_000_000, output: 500_000, cached: 200_000 };
    const model = { priceIn: 1, priceOut: 4, currency: "USD", packaged: false };
    expect(estimateCost(usage, model)).toEqual({ cost: 0.8 + 0.1 + 2, currency: "USD" });
    expect(estimateCost(usage, { ...model, packaged: true }).cost).toBe(0);
    expect(estimateCost(usage, { priceIn: null, priceOut: null, currency: null, packaged: false }).cost).toBeNull();
  });
});

describe("upstreamMessage", () => {
  it("pesan ramah per status", () => {
    expect(upstreamMessage(401, { error: { message: "invalid key" } })).toBe(
      "API key ditolak sumber model: invalid key",
    );
    expect(upstreamMessage(429, {})).toBe("Kuota / batas pemakaian sumber model habis.");
    expect(upstreamMessage(500, { message: "x".repeat(500) })).toHaveLength(
      "Sumber model menjawab galat 500: ".length + 300,
    );
  });
});
