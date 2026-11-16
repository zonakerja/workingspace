import { describe, expect, it } from "vitest";
import { summarizeUsage, usageDays, type UsageRow } from "./usage-logic";

const row = (over: Partial<UsageRow>): UsageRow => ({
  modelId: "m1",
  task: "chat",
  clientId: "akasha",
  ok: true,
  inputTokens: 10,
  outputTokens: 5,
  cost: null,
  currency: null,
  ...over,
});

describe("usage-logic", () => {
  it("menjumlahkan total, per model, tugas, aplikasi", () => {
    const s = summarizeUsage([
      row({ cost: 0.5, currency: "USD" }),
      row({ ok: false, inputTokens: null, outputTokens: null }),
      row({ modelId: "m2", task: "embedding", clientId: "web", cost: 1000, currency: "IDR" }),
    ]);
    expect(s.total).toMatchObject({ calls: 3, failed: 1, inputTokens: 20, outputTokens: 10 });
    expect(s.total.cost).toEqual({ USD: 0.5, IDR: 1000 });
    expect(s.byModel[0]).toMatchObject({ key: "m1", calls: 2, failed: 1 });
    expect(s.byTask.map((g) => g.key)).toEqual(["chat", "embedding"]);
    expect(s.byApp.find((g) => g.key === "web")?.calls).toBe(1);
  });

  it("rentang hari dibatasi", () => {
    expect(usageDays(undefined)).toBe(30);
    expect(usageDays("7")).toBe(7);
    expect(usageDays("1000")).toBe(90);
    expect(usageDays("0")).toBe(1);
  });
});
