import { describe, expect, it } from "vitest";
import type { McpToolSummary } from "@/types/api";
import {
  agentAllowed,
  groupPresets,
  parseArgs,
  sharedClientSource,
  toggleAgentTool,
  toolCounts,
  toolKind,
} from "./mcp-utils";

const tool = (over: Partial<McpToolSummary>): McpToolSummary => ({
  name: "t",
  title: null,
  description: "",
  readOnly: false,
  destructive: false,
  ...over,
});

describe("mcp utils", () => {
  it("classifies tools", () => {
    expect(toolKind(tool({ readOnly: true }))).toBe("read");
    expect(toolKind(tool({}))).toBe("write");
    expect(toolKind(tool({ destructive: true, readOnly: true }))).toBe("delete");
    expect(toolCounts([tool({ readOnly: true }), tool({}), tool({ destructive: true })])).toEqual({
      read: 1,
      write: 1,
      delete: 1,
    });
  });

  it("mirrors the server agent rule", () => {
    const read = tool({ readOnly: true });
    const write = tool({});
    const del = tool({ destructive: true });
    expect(agentAllowed({ agentEnabled: false, allowWrite: true }, read)).toBe(false);
    expect(agentAllowed({ agentEnabled: true, allowWrite: false }, read)).toBe(true);
    expect(agentAllowed({ agentEnabled: true, allowWrite: false }, write)).toBe(false);
    expect(agentAllowed({ agentEnabled: true, allowWrite: true }, write)).toBe(true);
    expect(agentAllowed({ agentEnabled: true, allowWrite: true }, del)).toBe(false);
  });

  it("parses tool arguments", () => {
    expect(parseArgs("")).toEqual({ ok: true, value: {} });
    expect(parseArgs('{"q":1}')).toEqual({ ok: true, value: { q: 1 } });
    expect(parseArgs("[1]").ok).toBe(false);
    expect(parseArgs("{x").ok).toBe(false);
  });
});

describe("OAuth client bersama & katalog berkelompok", () => {
  const presets = [{ key: "github" }, { key: "gmail", group: "google" }, { key: "google-docs", group: "google" }];
  it("memakai client dari layanan sekelompok yang sudah punya client", () => {
    const conns = [
      { preset: "github", name: "GitHub", oauthClientId: "gh" },
      { preset: "gmail", name: "Gmail", oauthClientId: "g-1" },
    ];
    expect(sharedClientSource({ group: "google" }, conns, presets)).toBe("Gmail");
    expect(
      sharedClientSource({ group: "google" }, [{ preset: "gmail", name: "Gmail", oauthClientId: null }], presets),
    ).toBeNull();
    expect(sharedClientSource(null, conns, presets)).toBeNull();
  });
  it("aplikasi tunggal dulu, lalu per kelompok", () => {
    const r = groupPresets(presets);
    expect(r.single.map((p) => p.key)).toEqual(["github"]);
    expect(r.groups).toEqual([{ key: "google", items: [presets[1], presets[2]] }]);
  });
});

describe("izin alat bertanda Hapus", () => {
  const del = tool({ name: "commit", readOnly: false, destructive: true });
  it("hanya bila diizinkan satu per satu dan aksi tulis menyala", () => {
    expect(agentAllowed({ agentEnabled: true, allowWrite: true }, del)).toBe(false);
    expect(agentAllowed({ agentEnabled: true, allowWrite: true, agentTools: ["commit"] }, del)).toBe(true);
    expect(agentAllowed({ agentEnabled: true, allowWrite: false, agentTools: ["commit"] }, del)).toBe(false);
  });
  it("toggleAgentTool", () => {
    expect(toggleAgentTool(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleAgentTool(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleAgentTool(["a"], "a", true)).toEqual(["a"]);
  });
});
