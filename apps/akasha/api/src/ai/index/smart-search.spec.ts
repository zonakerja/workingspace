import { describe, expect, it } from "vitest";
import {
  displayTitle,
  fileControlTab,
  groupBySource,
  likePattern,
  moduleOf,
  prefixTsQuery,
  queryTerms,
  readableRecordText,
  searchSnippet,
} from "./smart-search";

describe("smart search", () => {
  it("maps sources to modules, archived resources to File Control", () => {
    expect(moduleOf("schedule")).toBe("planner");
    expect(moduleOf("ai_note")).toBe("notes");
    expect(moduleOf("para_task")).toBe("productivity");
    expect(moduleOf("para_resource", null)).toBe("productivity");
    expect(moduleOf("para_resource", "none")).toBe("productivity");
    expect(moduleOf("para_resource", "pending")).toBe("file_control");
    expect(moduleOf("archive_jra")).toBe("file_control");
    expect(moduleOf("asset")).toBe("files");
    expect(moduleOf("obsidian_canvas")).toBe("knowledge");
    expect(moduleOf("unknown")).toBe("other");
  });

  it("builds a safe prefix query", () => {
    expect(prefixTsQuery("Nota  Din")).toBe("nota:* & din:*");
    expect(prefixTsQuery("182/SDJ.KEU")).toBe("182:* & sdj:* & keu:*");
    expect(prefixTsQuery("a'); drop table x; --")).toBe("a:* & drop:* & table:* & x:*");
    expect(prefixTsQuery("  !!  ")).toBe("");
    expect(prefixTsQuery("arsip tanah", true)).toBe("arsip:* | tanah:*");
    expect(queryTerms("Kendaraan dinas kendaraan")).toEqual(["kendaraan", "dinas"]);
    expect(queryTerms("a b c d e f g h i j")).toHaveLength(8);
  });

  it("escapes LIKE patterns", () => {
    expect(likePattern(" 50%_a\\b ")).toBe("%50\\%\\_a\\\\b%");
  });

  it("cuts a snippet around the first match, ignoring case and accents", () => {
    const long = `${"awal ".repeat(80)}Surat penghapusan Kendaraan dinas tahun lalu ${"akhir ".repeat(80)}`;
    const snippet = searchSnippet(long, "kendaraan");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("Kendaraan dinas");
    expect(snippet.length).toBeLessThanOrEqual(222);
    expect(searchSnippet("Kafe  di\nsini", "x")).toBe("Kafe di sini");
    expect(searchSnippet(`${"x ".repeat(200)}café`, "cafe")).toContain("café");
    expect(searchSnippet("y ".repeat(200), "tidakada").startsWith("y")).toBe(true);
  });

  it("keeps only meaningful record values for snippets", () => {
    expect(
      readableRecordText(
        "number: UJI/MUSNAH\ntype: file\ndate: 2012-01-01\ntags: Global Resource\narchivalStatus: physical\nisAutoDispose: true\narchiveRegId: ARC-1",
      ),
    ).toBe("UJI/MUSNAH · 2012-01-01 · Global Resource · ARC-1");
    expect(readableRecordText("description: baris satu\nlanjutan teks")).toBe("baris satu · lanjutan teks");
  });

  it("strips the kind label from titles", () => {
    expect(displayTitle("Resource: RAB 2012")).toBe("RAB 2012");
    expect(displayTitle("Berkas: nota.pdf")).toBe("nota.pdf");
    expect(displayTitle("Rapat koordinasi")).toBe("Rapat koordinasi");
  });

  it("groups hits per source keeping rank order", () => {
    const hit = (sourceType: string, sourceId: string) => ({ sourceType, sourceId, title: "", content: "" });
    const groups = groupBySource([hit("asset", "1"), hit("todo", "2"), hit("asset", "1"), hit("asset", "3")]);
    expect(groups.map((g) => [g.hit.sourceId, g.matches])).toEqual([
      ["1", 2],
      ["2", 1],
      ["3", 1],
    ]);
  });

  it("chooses the File Control tab", () => {
    expect(fileControlTab("physical")).toBe("physical");
    expect(fileControlTab("digital")).toBe("digital");
    expect(fileControlTab("pending")).toBe("pending");
    expect(fileControlTab(null)).toBe("pending");
  });
});
