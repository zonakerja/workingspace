import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Caller } from "../common/caller";
import { AkaiCrypto } from "../common/crypto";
import type { Prisma } from "../generated/prisma/client";
import { ConnectorsService } from "../connectors/connectors.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeBaseUrl } from "../sources/source-logic";
import type { SkillDef } from "../skills/skill-logic";
import { PACKAGE_TEMPLATE, PLUGIN_CATALOG, PLUGIN_TEMPLATE } from "./plugin-catalog";
import { createPluginFetch } from "./plugin-fetch";
import {
  PLUGIN_LIMITS,
  type PackageConnector,
  type PluginManifest,
  looksLikePackage,
  missingConfig,
  normalizeManifest,
  packageInstructionsBlock,
  pluginToolAllowed,
  pluginToolName,
  publicConfig,
  validateManifest,
  validatePackage,
} from "./plugin-logic";
import { inspectPlugin, runPluginTool } from "./plugin-sandbox";

export type PluginInput = {
  code?: string;
  catalogKey?: string;
  enabled?: boolean;
  allowWrite?: boolean;
  /** Nilai pengaturan: isian rahasia yang tidak dikirim / "••••••" = tetap, "" = dikosongkan */
  config?: Record<string, string>;
};

type PluginRow = {
  id: string;
  name: string;
  kind: string;
  title: string;
  description: string;
  version: string;
  code: string;
  manifest: Prisma.JsonValue;
  configEnc: string | null;
  enabled: boolean;
  allowWrite: boolean;
  updatedAt: Date;
};

export interface PluginBinding {
  pluginId: string;
  pluginTitle: string;
  tool: string;
}

const MASK = "••••••";

/**
 * Plugin Akai (6b.7, docs/AKAI.md §8), dua bentuk: **kode** JavaScript milik pemilik yang dijalankan di sandbox QuickJS untuk
 * menambah alat (+ skill), dan **paket** JSON seperti plugin Claude (instruksi tetap + skill + konektor MCP yang dibuat bersama paket).
 * Hanya sesi Akai web yang mengelola; chat & tugas terjadwal memakai `toolset` / `call` / `skills` / `instructions`.
 */
@Injectable()
export class PluginsService {
  private readonly crypto: AkaiCrypto;
  private readonly allowLocal: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectors: ConnectorsService,
    config: ConfigService,
  ) {
    this.crypto = new AkaiCrypto(config.getOrThrow<string>("AKAI_ENCRYPTION_KEY"));
    this.allowLocal = config.get<string>("NODE_ENV") !== "production";
  }

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Plugin hanya untuk Akai web.");
  }

  private manifestOf(row: PluginRow) {
    return normalizeManifest(row.manifest);
  }

  private configOf(row: Pick<PluginRow, "configEnc">): Record<string, string> {
    if (!row.configEnc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(row.configEnc)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private view(row: PluginRow, connectors: Awaited<ReturnType<ConnectorsService["forPlugin"]>> = []) {
    const manifest = this.manifestOf(row);
    const values = this.configOf(row);
    return {
      id: row.id,
      name: row.name,
      kind: manifest.kind,
      instructions: manifest.instructions,
      connectors,
      title: row.title,
      description: row.description,
      version: row.version,
      enabled: row.enabled,
      allowWrite: row.allowWrite,
      hosts: manifest.hosts,
      tools: manifest.tools.map((t) => ({ ...t, usable: pluginToolAllowed(t, row.allowWrite) })),
      skills: manifest.skills.map((s) => ({ name: s.name, description: s.description, files: (s.files ?? []).length })),
      configFields: manifest.config,
      config: publicConfig(manifest.config, values),
      missingConfig: missingConfig(manifest.config, values),
      updatedAt: row.updatedAt,
    };
  }

  /** Periksa isi plugin: paket JSON dibaca tanpa menjalankan apa pun; kode dimuat di sandbox. Galat = 400 untuk pemilik. */
  private async inspect(code: string) {
    if (!code.trim()) throw new BadRequestException("Isi plugin kosong.");
    if (code.length > PLUGIN_LIMITS.codeChars)
      throw new BadRequestException(`Isi plugin maks. ${PLUGIN_LIMITS.codeChars.toLocaleString("id-ID")} karakter.`);
    if (looksLikePackage(code)) {
      const pkg = validatePackage(code);
      if (!pkg.manifest) throw new BadRequestException(pkg.error);
      return pkg.manifest;
    }
    let raw: unknown;
    try {
      raw = await inspectPlugin(code);
    } catch (error) {
      throw new BadRequestException(
        `Kode plugin gagal dimuat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const result = validateManifest(raw, this.allowLocal);
    if (!result.manifest) throw new BadRequestException(result.error);
    return result.manifest;
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const rows = await this.prisma.plugin.findMany({
      where: { accountId: caller.account.id },
      orderBy: { title: "asc" },
    });
    const installed = new Set(rows.map((r) => r.name));
    return {
      plugins: await Promise.all(
        rows.map(async (r) =>
          this.view(r, r.kind === "package" ? await this.connectors.forPlugin(r.accountId, r.id) : []),
        ),
      ),
      catalog: PLUGIN_CATALOG.map((c) => ({
        key: c.key,
        title: c.title,
        description: c.description,
        installed: installed.has(c.key),
        kind: looksLikePackage(c.code) ? "package" : "code",
      })),
      template: PLUGIN_TEMPLATE,
      packageTemplate: PACKAGE_TEMPLATE,
    };
  }

  private async own(caller: Caller, id: string) {
    const row = await this.prisma.plugin.findFirst({ where: { id, accountId: caller.account.id } });
    if (!row) throw new NotFoundException("Plugin tidak ditemukan.");
    return row;
  }

  async get(caller: Caller, id: string) {
    this.requireWeb(caller);
    const row = await this.own(caller, id);
    const connectors = row.kind === "package" ? await this.connectors.forPlugin(row.accountId, row.id) : [];
    return { ...this.view(row, connectors), code: row.code };
  }

  /** Nilai pengaturan baru dari isian (rahasia tidak terkirim / bertanda = nilai lama). */
  private mergeConfig(manifest: PluginManifest, current: Record<string, string>, input?: Record<string, string>) {
    const next: Record<string, string> = {};
    for (const field of manifest.config) {
      const value = input?.[field.key];
      if (value === undefined || (field.secret && value === MASK)) {
        if (current[field.key]) next[field.key] = current[field.key];
      } else if (String(value).trim()) next[field.key] = String(value).slice(0, 4000);
    }
    return next;
  }

  async install(caller: Caller, input: PluginInput) {
    this.requireWeb(caller);
    const code = input.catalogKey ? PLUGIN_CATALOG.find((c) => c.key === input.catalogKey)?.code : input.code;
    if (code === undefined) throw new NotFoundException("Plugin katalog tidak ditemukan.");
    const manifest = await this.inspect(code);
    const count = await this.prisma.plugin.count({ where: { accountId: caller.account.id } });
    if (count >= PLUGIN_LIMITS.maxPlugins) throw new BadRequestException(`Maks. ${PLUGIN_LIMITS.maxPlugins} plugin.`);
    if (await this.prisma.plugin.findFirst({ where: { accountId: caller.account.id, name: manifest.name } }))
      throw new ConflictException(`Plugin bernama ${manifest.name} sudah terpasang.`);
    if (manifest.kind === "package")
      await this.connectors.checkPackageConnectors(caller.account.id, manifest.connectors);
    const values = this.mergeConfig(manifest, {}, input.config);
    const row = await this.prisma.plugin.create({
      data: {
        accountId: caller.account.id,
        name: manifest.name,
        kind: manifest.kind,
        title: manifest.title,
        description: manifest.description,
        version: manifest.version,
        code,
        manifest: manifest as unknown as Prisma.InputJsonValue,
        configEnc: Object.keys(values).length ? this.crypto.encrypt(JSON.stringify(values)) : null,
        enabled: input.enabled ?? true,
        allowWrite: input.allowWrite ?? false,
      },
    });
    try {
      await this.syncConnectors(caller.account.id, row.id, manifest.connectors, row.enabled);
    } catch (error) {
      // Konektor gagal dibuat = paket tidak jadi dipasang (tidak ada paket setengah jadi)
      await this.prisma.plugin.delete({ where: { id: row.id } }).catch(() => undefined);
      throw error;
    }
    return this.get(caller, row.id);
  }

  /** Samakan konektor bawaan paket dengan isi paket: yang baru dibuat, yang tidak lagi ada di paket dihapus. */
  private async syncConnectors(accountId: string, pluginId: string, specs: PackageConnector[], enabled: boolean) {
    const key = (c: { preset?: string | null; kind?: string; url: string | null }) => {
      if (c.preset === "akasha" || c.kind === "akasha") return "akasha";
      const n = normalizeBaseUrl(c.url ?? "", !this.allowLocal);
      return n.ok ? n.url : (c.url ?? "");
    };
    const linked = await this.prisma.connector.findMany({ where: { accountId, pluginId } });
    const wanted = new Set(specs.map(key));
    const stale = linked.filter((c) => !wanted.has(key(c)));
    if (stale.length) await this.prisma.connector.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } });
    const have = new Set(linked.map(key));
    for (const spec of specs)
      if (!have.has(key(spec))) await this.connectors.createForPlugin(accountId, pluginId, spec);
    await this.connectors.setPluginEnabled(pluginId, enabled);
  }

  /** Instruksi tetap dari paket yang menyala → blok prompt sistem (null = tidak ada). */
  async instructions(accountId: string) {
    const rows = await this.prisma.plugin.findMany({
      where: { accountId, enabled: true, kind: "package" },
      orderBy: { createdAt: "asc" },
    });
    return packageInstructionsBlock(
      rows.map((r) => ({ title: r.title, instructions: this.manifestOf(r).instructions })),
    );
  }

  async update(caller: Caller, id: string, input: PluginInput) {
    this.requireWeb(caller);
    const row = await this.own(caller, id);
    let manifest = this.manifestOf(row);
    const data: Prisma.PluginUpdateInput = {};
    if (input.code !== undefined && input.code !== row.code) {
      manifest = await this.inspect(input.code);
      if (
        manifest.name !== row.name &&
        (await this.prisma.plugin.findFirst({ where: { accountId: caller.account.id, name: manifest.name } }))
      )
        throw new ConflictException(`Plugin bernama ${manifest.name} sudah terpasang.`);
      if (manifest.kind === "package") {
        const linked = await this.prisma.connector.count({ where: { pluginId: row.id } });
        await this.connectors.checkPackageConnectors(caller.account.id, manifest.connectors, linked);
      }
      Object.assign(data, {
        code: input.code,
        kind: manifest.kind,
        name: manifest.name,
        title: manifest.title,
        description: manifest.description,
        version: manifest.version,
        manifest: manifest as unknown as Prisma.InputJsonValue,
      });
    }
    if (input.config !== undefined || data.manifest) {
      const values = this.mergeConfig(manifest, this.configOf(row), input.config);
      data.configEnc = Object.keys(values).length ? this.crypto.encrypt(JSON.stringify(values)) : null;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.allowWrite !== undefined) data.allowWrite = input.allowWrite;
    const updated = await this.prisma.plugin.update({ where: { id }, data });
    if (data.manifest || input.enabled !== undefined)
      await this.syncConnectors(caller.account.id, id, manifest.connectors, updated.enabled);
    return this.get(caller, id);
  }

  async remove(caller: Caller, id: string) {
    this.requireWeb(caller);
    const done = await this.prisma.plugin.deleteMany({ where: { id, accountId: caller.account.id } });
    if (!done.count) throw new NotFoundException("Plugin tidak ditemukan.");
  }

  private run(row: PluginRow, tool: string, args: Record<string, unknown>) {
    const manifest = this.manifestOf(row);
    return runPluginTool(
      row.code,
      tool,
      args,
      this.configOf(row),
      createPluginFetch({ hosts: manifest.hosts, allowLocal: this.allowLocal }),
    );
  }

  /** Uji satu alat dari halaman Plugin (pemilik; juga alat yang belum diizinkan untuk chat). */
  async test(caller: Caller, id: string, tool: string, input: Record<string, unknown>) {
    this.requireWeb(caller);
    const row = await this.own(caller, id);
    if (!this.manifestOf(row).tools.some((t) => t.name === tool))
      throw new BadRequestException("Alat tidak ada di plugin ini.");
    return this.run(row, tool, input);
  }

  /** Alat plugin yang boleh dipakai chat (plugin menyala, pengaturan wajib lengkap) — format OpenAI + peta nama. */
  async toolset(accountId: string) {
    const rows = await this.prisma.plugin.findMany({
      where: { accountId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    const map = new Map<string, PluginBinding>();
    const tools: Record<string, unknown>[] = [];
    for (const row of rows) {
      const manifest = this.manifestOf(row);
      if (missingConfig(manifest.config, this.configOf(row)).length) continue;
      for (const tool of manifest.tools) {
        if (!pluginToolAllowed(tool, row.allowWrite)) continue;
        const name = pluginToolName(row.name, tool.name);
        if (map.has(name)) continue;
        map.set(name, { pluginId: row.id, pluginTitle: row.title, tool: tool.name });
        tools.push({
          type: "function",
          function: {
            name,
            description: `[Plugin ${row.title}] ${tool.description}`.slice(0, 1024),
            parameters: tool.input,
          },
        });
      }
    }
    return { tools, map };
  }

  /** Jalankan alat plugin untuk chat (galat = teks hasil agar model bisa menjelaskan). */
  async call(accountId: string, binding: PluginBinding, args: Record<string, unknown>) {
    const row = await this.prisma.plugin.findFirst({ where: { id: binding.pluginId, accountId, enabled: true } });
    if (!row) return { isError: true, text: "Plugin tidak ditemukan atau dimatikan." };
    const tool = this.manifestOf(row).tools.find((t) => t.name === binding.tool);
    if (!tool || !pluginToolAllowed(tool, row.allowWrite))
      return { isError: true, text: "Alat plugin tidak diizinkan." };
    const result = await this.run(row, binding.tool, args);
    return { isError: result.isError, text: result.text || "(alat tidak mengembalikan isi)" };
  }

  /** Skill bawaan plugin yang menyala (nama `<plugin>-<skill>`), digabung ke daftar skill chat. */
  async skills(accountId: string): Promise<(SkillDef & { plugin: string })[]> {
    const rows = await this.prisma.plugin.findMany({
      where: { accountId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.flatMap((row) =>
      this.manifestOf(row).skills.map((s) => ({
        name: `${row.name}-${s.name}`.slice(0, 64),
        description: s.description,
        instructions: s.instructions,
        files: s.files ?? [],
        plugin: row.title,
      })),
    );
  }
}
