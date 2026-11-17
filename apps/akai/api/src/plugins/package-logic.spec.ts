import { describe, expect, it } from "vitest";
import { PACKAGE_TEMPLATE, PLUGIN_CATALOG } from "./plugin-catalog";
import { looksLikePackage, normalizeManifest, packageInstructionsBlock, validatePackage } from "./plugin-logic";

const pkg = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "akai-package",
    name: "paket-uji",
    description: "Paket uji",
    instructions: "Selalu ringkas.",
    ...extra,
  });

describe("paket plugin", () => {
  it("dikenali dari isi dan divalidasi", () => {
    expect(looksLikePackage('  {"type":"akai-package"}')).toBe(true);
    expect(looksLikePackage("// kode\ndefinePlugin({})")).toBe(false);
    const ok = validatePackage(
      pkg({
        skills: [
          {
            name: "rangkum",
            description: "Merangkum",
            instructions: "# Langkah",
            files: [{ path: "a.md", content: "x" }],
          },
        ],
        connectors: [{ preset: "akasha" }, { name: "MCP", url: "https://mcp.contoh.id/mcp", auth: "token" }],
      }),
    );
    expect(ok.error).toBeNull();
    expect(ok.manifest).toMatchObject({ kind: "package", title: "paket-uji", tools: [], hosts: [] });
    expect(ok.manifest?.connectors).toEqual([
      { name: "Akasha", preset: "akasha", url: null, auth: "token", allowWrite: false, description: "" },
      {
        name: "MCP",
        preset: null,
        url: "https://mcp.contoh.id/mcp",
        auth: "token",
        allowWrite: false,
        description: "",
      },
    ]);
    expect(ok.manifest?.skills[0].files).toEqual([{ path: "a.md", content: "x" }]);
  });

  it("galat bermakna", () => {
    expect(validatePackage("{ rusak").error).toMatch(/JSON/);
    expect(validatePackage(JSON.stringify({ name: "a" })).error).toMatch(/akai-package/);
    expect(validatePackage(pkg({ name: "Nama Salah" })).error).toMatch(/huruf kecil/);
    expect(validatePackage(pkg({ instructions: "", skills: [], connectors: [] })).error).toMatch(/kosong/);
    expect(validatePackage(pkg({ instructions: "x".repeat(4001) })).error).toMatch(/maks/);
    expect(validatePackage(pkg({ connectors: [{ preset: "lain" }] })).error).toMatch(/Preset/);
    expect(validatePackage(pkg({ connectors: [{ name: "x" }] })).error).toMatch(/url/);
    expect(validatePackage(pkg({ connectors: [{ preset: "akasha" }, { preset: "akasha" }] })).error).toMatch(/ganda/);
    expect(
      validatePackage(
        pkg({ skills: [{ name: "a", description: "d", instructions: "i", files: [{ path: "../x", content: "" }] }] }),
      ).error,
    ).toMatch(/Nama berkas/);
  });

  it("manifest lama = plugin kode; blok instruksi", () => {
    expect(normalizeManifest({ name: "x", tools: [] })).toMatchObject({
      kind: "code",
      instructions: "",
      connectors: [],
    });
    expect(packageInstructionsBlock([{ title: "A", instructions: "  " }])).toBeNull();
    expect(packageInstructionsBlock([{ title: 'A"B', instructions: "Pakai tabel." }])).toContain(
      '<paket nama="A\'B">\nPakai tabel.\n</paket>',
    );
  });

  it("templat & paket katalog sah", () => {
    expect(validatePackage(PACKAGE_TEMPLATE).error).toBeNull();
    for (const c of PLUGIN_CATALOG.filter((x) => looksLikePackage(x.code)))
      expect(validatePackage(c.code).error).toBeNull();
  });
});
