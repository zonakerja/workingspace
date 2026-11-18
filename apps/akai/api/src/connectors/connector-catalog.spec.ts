import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_CATEGORIES,
  authorizationExtras,
  findCatalogEntry,
  normalizeScope,
  oauthErrorMessage,
} from "./connector-catalog";

describe("katalog konektor", () => {
  it("kunci unik, alamat https, kategori dikenal", () => {
    const keys = CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CATALOG) {
      expect(new URL(e.url).protocol).toBe("https:");
      expect(Object.keys(CATALOG_CATEGORIES)).toContain(e.category);
      expect(e.hint.length).toBeGreaterThan(5);
    }
  });

  it("aplikasi tanpa pendaftaran otomatis selalu OAuth + client milik pemilik", () => {
    const manual = CATALOG.filter((e) => e.needsClient);
    expect(manual.map((e) => e.key)).toEqual(expect.arrayContaining(["gmail", "slack", "box", "hubspot"]));
    expect(manual.every((e) => e.auth === "oauth")).toBe(true);
    expect(CATALOG.filter((e) => e.group === "google").every((e) => e.needsClient && e.scope)).toBe(true);
  });

  it("aplikasi populer tersedia", () => {
    expect(findCatalogEntry("canva")?.auth).toBe("oauth");
    expect(findCatalogEntry("notion")?.url).toBe("https://mcp.notion.com/mcp");
    expect(findCatalogEntry("github")?.auth).toBe("token");
    expect(findCatalogEntry("tidak-ada")).toBeNull();
  });

  it("scope, parameter Google, pesan galat", () => {
    expect(normalizeScope("a, b\nb  c")).toBe("a b c");
    expect(normalizeScope("  ")).toBeNull();
    expect(authorizationExtras(new URL("https://accounts.google.com/o/oauth2/auth"))).toEqual({
      access_type: "offline",
      prompt: "consent",
    });
    expect(authorizationExtras(new URL("https://mcp.canva.com/authorize"))).toEqual({});
    expect(oauthErrorMessage("Incompatible auth server: does not support dynamic client registration")).toMatch(
      /Client ID/,
    );
  });
});
