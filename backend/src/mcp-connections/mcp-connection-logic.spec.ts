import { describe, expect, it } from "vitest";
import {
  agentToolDecision,
  agentToolList,
  authorizationExtras,
  findPreset,
  MCP_PRESETS,
  normalizeMcpUrl,
  normalizeScope,
  oauthErrorMessage,
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
    // Alat bertanda Hapus hanya bila diizinkan satu per satu DAN aksi tulis menyala
    expect(agentToolDecision({ agentEnabled: true, allowWrite: true, agentTools: ["d"] }, destroy).ok).toBe(true);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: false, agentTools: ["d"] }, destroy).ok).toBe(false);
    expect(agentToolDecision({ agentEnabled: true, allowWrite: true, agentTools: ["lain"] }, destroy).ok).toBe(false);
    expect(agentToolDecision({ agentEnabled: false, allowWrite: true, agentTools: ["d"] }, destroy).ok).toBe(false);
    expect(agentToolList(["a", "a", 3, "", "b"])).toEqual(["a", "b"]);
    expect(agentToolList(null)).toEqual([]);
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

describe("OAuth client manual & Google Workspace", () => {
  it("katalog Google: https, OAuth, wajib client, satu kelompok, scope bawaan", () => {
    const google = MCP_PRESETS.filter((p) => p.group === "google");
    expect(google.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        "gmail",
        "google-calendar",
        "google-drive",
        "google-docs",
        "google-sheets",
        "google-slides",
      ]),
    );
    for (const p of google) {
      expect(normalizeMcpUrl(p.url, true).ok).toBe(true);
      expect(p).toMatchObject({ authType: "oauth", needsClient: true });
      expect(p.scope).toMatch(/googleapis\.com\/auth\//);
    }
    expect(new Set(MCP_PRESETS.map((p) => p.key)).size).toBe(MCP_PRESETS.length);
  });

  it("normalizeScope: spasi/koma/baris, tanpa duplikat, kosong = null", () => {
    expect(normalizeScope(" a, b\nb  c ")).toBe("a b c");
    expect(normalizeScope("   ")).toBeNull();
    expect(normalizeScope(undefined)).toBeNull();
  });

  it("Google meminta refresh token, penyedia lain tidak diubah", () => {
    expect(authorizationExtras(new URL("https://accounts.google.com/o/oauth2/v2/auth"))).toEqual({
      access_type: "offline",
      prompt: "consent",
    });
    expect(authorizationExtras(new URL("https://github.com/login/oauth/authorize"))).toEqual({});
  });

  it("pesan galat OAuth yang bisa ditindaklanjuti", () => {
    expect(oauthErrorMessage("Incompatible auth server: does not support dynamic client registration")).toMatch(
      /Client ID/,
    );
    expect(oauthErrorMessage("invalid_client")).toMatch(/ditolak/);
    expect(oauthErrorMessage("lain")).toBe("lain");
  });
});
