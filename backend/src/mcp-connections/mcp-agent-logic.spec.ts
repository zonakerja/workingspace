import { describe, expect, it } from "vitest";
import { accessChange, accessRequestTitle, connectProposal, connectRequestTitle } from "./mcp-agent-logic";

describe("connectProposal", () => {
  it("mengisi alamat & cara masuk dari katalog", () => {
    const r = connectProposal({ preset: "notion" }, true);
    expect(r).toEqual({
      ok: true,
      proposal: {
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        preset: "notion",
        authType: "oauth",
        icon: "book-open",
      },
    });
    if (r.ok) expect(connectRequestTitle(r.proposal)).toBe("Sambungkan aplikasi MCP: Notion");
  });

  it("menerima alamat sendiri dan menolak yang tidak aman", () => {
    expect(
      connectProposal({ name: " Alat  Tim ", url: "https://mcp.contoh.com/mcp", authType: "token" }, true),
    ).toMatchObject({
      ok: true,
      proposal: { name: "Alat Tim", preset: null, authType: "token", icon: "plug" },
    });
    expect(connectProposal({ name: "X", url: "http://mcp.contoh.com" }, true)).toMatchObject({ ok: false });
    expect(connectProposal({ name: "X", url: "https://127.0.0.1/mcp" }, true)).toMatchObject({ ok: false });
    expect(connectProposal({ name: "X", url: "https://a.com", authType: "kunci" }, true)).toMatchObject({ ok: false });
  });

  it("menolak katalog tak dikenal, tanpa nama, tanpa alamat", () => {
    expect(connectProposal({ preset: "tidak-ada" }, true)).toMatchObject({ ok: false });
    expect(connectProposal({ url: "https://a.com" }, true)).toMatchObject({ ok: false });
    expect(connectProposal({ name: "A" }, true)).toMatchObject({ ok: false });
  });
});

describe("accessChange", () => {
  const off = { agentEnabled: false, allowWrite: false };
  it("hanya key yang berbeda", () => {
    expect(accessChange(off, { agentEnabled: true })).toEqual({ agentEnabled: true });
    expect(accessChange({ agentEnabled: true, allowWrite: false }, { agentEnabled: true, allowWrite: true })).toEqual({
      allowWrite: true,
    });
  });

  it("aksi tulis ikut menyalakan izin agen", () => {
    expect(accessChange(off, { allowWrite: true })).toEqual({ agentEnabled: true, allowWrite: true });
    expect(accessRequestTitle("Notion", { agentEnabled: true, allowWrite: true })).toBe(
      "Izin agen Notion: izinkan agen + izinkan aksi tulis",
    );
  });

  it("menolak permintaan kosong & bertentangan", () => {
    expect(accessChange(off, { agentEnabled: false })).toHaveProperty("error");
    expect(accessChange(off, { agentEnabled: false, allowWrite: true })).toHaveProperty("error");
  });
});

describe("accessChange allowTools", () => {
  const app = { agentEnabled: true, allowWrite: false, agentTools: ["a"], destructiveTools: ["a", "commit"] };
  it("hanya alat bertanda Hapus yang ada, ikut menyalakan aksi tulis, hanya yang baru", () => {
    expect(accessChange(app, { allowTools: ["commit", "a"] })).toEqual({ allowWrite: true, allowTools: ["commit"] });
    expect(accessChange(app, { allowTools: ["search"] })).toHaveProperty("error");
    expect(accessChange({ ...app, allowWrite: true }, { allowTools: ["a"] })).toHaveProperty("error");
    expect(accessRequestTitle("Canva", { allowTools: ["commit"] })).toBe("Izin agen Canva: izinkan alat commit");
  });
});
