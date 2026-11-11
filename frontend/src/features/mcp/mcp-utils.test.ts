import { describe, expect, it } from "vitest";
import type { McpToolSummary } from "@/types/api";
import { agentAllowed, parseArgs, toolCounts, toolKind } from "./mcp-utils";

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
