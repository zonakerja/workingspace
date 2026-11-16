import { describe, expect, it } from "vitest";
import {
  buildToolset,
  connectorSlug,
  excerpt,
  modelToolName,
  parseArgs,
  summarizeTools,
  toolAccess,
  toolAllowed,
  toolResultText,
} from "./connector-logic";

describe("connector-logic", () => {
  it("slug & nama alat untuk model", () => {
    expect(connectorSlug("Akasha Kantor!")).toBe("akasha_kantor");
    expect(connectorSlug("!!!")).toBe("konektor");
    expect(modelToolName("akasha", "search.knowledge")).toBe("akasha__search_knowledge");
    expect(modelToolName("x", "a".repeat(100))).toHaveLength(64);
  });

  it("ringkasan alat & jenis akses", () => {
    const [read, write, del] = summarizeTools([
      { name: "cari", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { q: {} } } },
      { name: "buat", description: "  Buat   to-do " },
      { name: "hapus", annotations: { destructiveHint: true } },
    ]);
    expect(toolAccess(read)).toBe("read");
    expect(write.description).toBe("Buat to-do");
    expect(write.inputSchema).toEqual({ type: "object", properties: {} });
    expect(toolAccess(del)).toBe("destructive");
    expect(toolAllowed(write, false)).toBe(false);
    expect(toolAllowed(write, true)).toBe(true);
    expect(toolAllowed(del, true)).toBe(false);
  });

  it("toolset: hanya alat yang diizinkan, nama dipetakan balik", () => {
    const tools = summarizeTools([
      { name: "cari", annotations: { readOnlyHint: true } },
      { name: "buat" },
      { name: "hapus", annotations: { destructiveHint: true } },
    ]);
    const set = buildToolset([{ id: "c1", name: "Akasha", slug: "akasha", allowWrite: false, tools }]);
    expect(set.tools).toHaveLength(1);
    expect(set.map.get("akasha__cari")?.tool.name).toBe("cari");
    const all = buildToolset([{ id: "c1", name: "Akasha", slug: "akasha", allowWrite: true, tools }]);
    expect([...all.map.keys()]).toEqual(["akasha__cari", "akasha__buat"]);
  });

  it("hasil, argumen, ringkasan", () => {
    expect(
      toolResultText([
        { type: "text", text: "a" },
        { type: "image", mimeType: "image/png" },
      ]),
    ).toBe("a\n[image image/png]");
    expect(toolResultText([{ type: "text", text: "x".repeat(30) }], 10)).toBe(`${"x".repeat(10)}…`);
    expect(parseArgs('{"q":"psp"}')).toEqual({ q: "psp" });
    expect(parseArgs("rusak")).toEqual({});
    expect(excerpt({ a: 1 })).toBe('{"a":1}');
  });
});
