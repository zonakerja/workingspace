import { describe, expect, it } from "vitest";
import type { SmartSearchResult } from "@/types/api";
import { highlightParts, kindLabel, moduleCounts, smartTarget } from "./smart-search-utils";

const result = (over: Partial<SmartSearchResult>): SmartSearchResult => ({
  sourceType: "todo",
  sourceId: "1",
  module: "planner",
  title: "T",
  snippet: "",
  matches: 1,
  ...over,
});

describe("smart search utils", () => {
  it("opens each source in the right place", () => {
    expect(smartTarget(result({ sourceType: "obsidian", sourceId: "n1", module: "knowledge" }))).toEqual({
      kind: "knowledge",
      noteId: "n1",
    });
    expect(
      smartTarget(
        result({
          sourceType: "asset",
          sourceId: "a1",
          module: "files",
          fileName: "x.pdf",
          mimeType: "application/pdf",
        }),
      ),
    ).toEqual({ kind: "file", uploadId: "a1", name: "x.pdf", mimeType: "application/pdf" });
    expect(
      smartTarget(
        result({ sourceType: "para_resource", sourceId: "r1", module: "file_control", archivalStatus: "physical" }),
      ),
    ).toEqual({ kind: "page", path: "/file-control/physical?archive=r1" });
    expect(smartTarget(result({ sourceType: "para_resource", sourceId: "r2", module: "working-space" }))).toEqual({
      kind: "page",
      path: "/working-space/resources?resource=r2",
    });
    expect(smartTarget(result({ sourceType: "archive_jra", module: "file_control" }))).toEqual({
      kind: "page",
      path: "/file-control/references",
    });
    expect(smartTarget(result({ sourceType: "notebook_source", notebookId: "nb", module: "notes" }))).toEqual({
      kind: "page",
      path: "/notes/notebook?notebook=nb",
    });
    expect(smartTarget(result({ sourceType: "ai_note", sourceId: "7", module: "notes" }))).toEqual({
      kind: "page",
      path: "/notes/ai?note=7",
    });
    expect(smartTarget(result({ sourceType: "unknown", module: "other" }))).toEqual({ kind: "none" });
  });

  it("labels archived resources by status", () => {
    expect(kindLabel(result({ sourceType: "para_resource", archivalStatus: "pending" }))).toBe("Arsip Gantung");
    expect(kindLabel(result({ sourceType: "para_resource", archivalStatus: null }))).toBe("Resource");
    expect(kindLabel(result({ sourceType: "asset" }))).toBe("Berkas");
  });

  it("counts results per module in fixed order", () => {
    expect(
      moduleCounts([result({ module: "files" }), result({ module: "planner" }), result({ module: "files" })]),
    ).toEqual([
      { module: "planner", count: 1 },
      { module: "files", count: 2 },
    ]);
  });

  it("highlights word prefixes ignoring case and accents", () => {
    const parts = highlightParts("Café Kendaraan dinas, berkendaraan", "kenda cafe");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["Café", "Kenda"]);
    expect(parts.map((p) => p.text).join("")).toBe("Café Kendaraan dinas, berkendaraan");
    expect(highlightParts("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(
      highlightParts("No 182/SDJ", "182 sdj")
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual(["182", "SDJ"]);
  });
});
