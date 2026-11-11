import { describe, expect, it } from "vitest";
import {
  agentToolDecision,
  findPreset,
  normalizeMcpUrl,
  summarizeTools,
  toolResultText,
  uniqueSlug,
} from "./mcp-connection-logic";

describe("mcp connection logic", () => {
  it("validates server URLs", () => {
    expect(normalizeMcpUrl("https://mcp.canva.com/mcp", true)).toEqual({ ok: true, url: "https://mcp.canva.com/mcp" });
    expect(normalizeMcpUrl("https://api.githubcopilot.com/mcp/#x", true)).toEqual({
      ok: true,
      url: "https://api.githubcopilot.com/mcp/",
    });
    expect(normalizeMcpUrl("http://mcp.contoh.com", true).ok).toBe(false);
    expect(normalizeMcpUrl("http://localhost:3333/mcp", false).ok).toBe(true);
    expect(normalizeMcpUrl("http://localhost:3333/mcp", true).ok).toBe(false);
    expect(normalizeMcpUrl("https://user:pw@mcp.contoh.com", false).ok).toBe(false);
    expect(normalizeMcpUrl("bukan url", false).ok).toBe(false);
  });

  it("makes unique slugs", () => {
    expect(uniqueSlug("Canva Desain", [])).toBe("canva-desain");
    expect(uniqueSlug("Canva", ["canva"])).toBe("canva-2");
    expect(uniqueSlug("Canva", ["canva", "canva-2"])).toBe("canva-3");
    expect(uniqueSlug("!!!", [])).toBe("aplikasi");
  });

  it("knows presets", () => {
    expect(findPreset("canva")?.authType).toBe("oauth");
    expect(findPreset("github")?.authType).toBe("token");
    expect(findPreset("x")).toBeNull();
  });

  it("summarizes tools from annotations", () => {
    expect(
      summarizeTools([
        { name: "search", description: "Cari  desain", annotations: { readOnlyHint: true } },
        { name: "delete", annotations: { destructiveHint: true } },
        { name: "create", title: "Buat" },
      ]),
    ).toEqual([
      { name: "search", title: null, description: "Cari desain", readOnly: true, destructive: false },
      { name: "delete", title: null, description: "", readOnly: false, destructive: true },
      { name: "create", title: "Buat", description: "", readOnly: false, destructive: false },
    ]);
  });

  it("decides what the agent may call", () => {
    const read = { name: "r", title: null, description: "", readOnly: true, destructive: false };
    const write = { ...read, name: "w", readOnly: false };
    const destroy = { ...write, name: "d", destructive: true };
    expect(agentToolDecision({ agentEnabled: false, allowWrite: true }, read).ok).toBe(false);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: false }, read).ok).toBe(true);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: false }, write).ok).toBe(false);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: true }, write).ok).toBe(true);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: true }, destroy).ok).toBe(false);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: true }, undefined).ok).toBe(false);
  });

  it("turns tool results into text", () => {
    expect(
      toolResultText([
        { type: "text", text: "halo" },
        { type: "image", mimeType: "image/png" },
      ]),
    ).toBe("halo\n[image image/png]");
    expect(toolResultText([{ type: "text", text: "x".repeat(30) }], 10)).toBe("xxxxxxxxxx…");
  });
});
