import { describe, expect, it } from "vitest";
import { PLUGIN_CATALOG, PLUGIN_TEMPLATE } from "./plugin-catalog";
import {
  hostAllowed,
  isPrivateAddress,
  looksLikePackage,
  missingConfig,
  pluginToolAllowed,
  pluginToolName,
  publicConfig,
  validateManifest,
} from "./plugin-logic";
import { inspectPlugin, runPluginTool } from "./plugin-sandbox";

const raw = {
  name: "kurs",
  description: "Kurs",
  hosts: ["api.contoh.id", "*.data.go.id"],
  config: [{ key: "apiKey", secret: true, required: true }],
  tools: [{ name: "cek", description: "Cek kurs", hasRun: true, readOnly: true }],
};

describe("plugin-logic", () => {
  it("manifest sah dirapikan; galat bermakna", () => {
    const ok = validateManifest(raw);
    expect(ok.error).toBeNull();
    expect(ok.manifest?.title).toBe("kurs");
    expect(ok.manifest?.tools[0].input).toEqual({ type: "object", properties: {} });
    expect(validateManifest(null).error).toMatch(/definePlugin/);
    expect(validateManifest({ ...raw, name: "Kurs Rupiah" }).error).toMatch(/huruf kecil/);
    expect(validateManifest({ ...raw, hosts: ["https://api.contoh.id"] }).error).toMatch(/Host tidak valid/);
    expect(validateManifest({ ...raw, hosts: ["localhost"] }).error).toMatch(/Host tidak valid/);
    expect(validateManifest({ ...raw, hosts: ["localhost"] }, true).error).toBeNull();
    expect(validateManifest({ ...raw, tools: [] }).error).toMatch(/minimal satu alat/);
    expect(validateManifest({ ...raw, tools: [{ name: "x", description: "d", hasRun: false }] }).error).toMatch(/run/);
  });

  it("izin host, alamat lokal, nama alat, izin pakai", () => {
    expect(hostAllowed("api.contoh.id", raw.hosts)).toBe(true);
    expect(hostAllowed("x.data.go.id", raw.hosts)).toBe(true);
    expect(hostAllowed("data.go.id", raw.hosts)).toBe(false);
    expect(hostAllowed("evil.id", raw.hosts)).toBe(false);
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(pluginToolName("kurs-mata-uang", "kurs")).toBe("p_kurs_mata_uang__kurs");
    expect(pluginToolAllowed({ readOnly: true, destructive: false }, false)).toBe(true);
    expect(pluginToolAllowed({ readOnly: false, destructive: false }, false)).toBe(false);
    expect(pluginToolAllowed({ readOnly: false, destructive: true }, true)).toBe(false);
  });

  it("pengaturan: wajib & rahasia disamarkan", () => {
    const fields = validateManifest(raw).manifest!.config;
    expect(missingConfig(fields, {})).toEqual(["apiKey"]);
    expect(publicConfig(fields, { apiKey: "rahasia" })).toEqual({ apiKey: "••••••" });
  });
});

describe("plugin-sandbox", () => {
  it("katalog & templat lolos pemeriksaan", async () => {
    for (const code of [...PLUGIN_CATALOG.map((c) => c.code).filter((c) => !looksLikePackage(c)), PLUGIN_TEMPLATE])
      expect(validateManifest(await inspectPlugin(code)).error).toBeNull();
  });

  it("menjalankan alat, akai.config, akai.log, akai.fetch lewat host", async () => {
    const code = `definePlugin({ name: "uji", description: "u", tools: [{ name: "a", description: "a", run: async (input, akai) => {
      akai.log("mulai", input.x);
      const r = await akai.fetch("https://api.contoh.id/x", { method: "POST" });
      return { x: input.x * 2, k: akai.config.k, status: r.status, data: r.json() };
    } }] });`;
    const calls: string[] = [];
    const result = await runPluginTool(code, "a", { x: 21 }, { k: "v" }, async (url, init) => {
      calls.push(`${JSON.parse(init).method} ${url}`);
      return JSON.stringify({ status: 200, url, headers: {}, body: '{"ok":true}' });
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ x: 42, k: "v", status: 200, data: { ok: true } });
    expect(result.logs).toEqual(["mulai 21"]);
    expect(calls).toEqual(["POST https://api.contoh.id/x"]);
  });

  it("galat plugin, fetch ditolak host, kode tanpa akses Node", async () => {
    const code = `definePlugin({ name: "uji", description: "u", tools: [
      { name: "gagal", description: "g", run: async () => { throw new Error("rusak"); } },
      { name: "net", description: "n", run: async (i, akai) => (await akai.fetch("https://x.id")).status },
      { name: "node", description: "n", run: async () => [typeof require, typeof process, typeof fetch].join(",") }
    ] });`;
    const deny = async () => {
      throw new Error("Host x.id tidak ada di izin plugin (hosts).");
    };
    expect((await runPluginTool(code, "gagal", {}, {}, deny)).text).toBe("Error: rusak");
    expect((await runPluginTool(code, "net", {}, {}, deny)).text).toMatch(/tidak ada di izin/);
    expect((await runPluginTool(code, "node", {}, {}, deny)).text).toBe("undefined,undefined,undefined");
  });

  it("loop tanpa akhir saat dimuat dihentikan; kode rusak ditolak", async () => {
    await expect(inspectPlugin("while (true) {}")).rejects.toThrow(/batas waktu/);
    await expect(inspectPlugin("definePlugin({")).rejects.toThrow(/SyntaxError/);
  }, 10_000);
});
