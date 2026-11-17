/**
 * Aturan Plugin Akai (6b.7, docs/AKAI.md §8). Logika murni, diuji di plugin-logic.spec.ts. Dua bentuk plugin:
 * - **kode** JavaScript (`definePlugin({...})`) yang dijalankan di sandbox: manifest, izin host jaringan, alamat terlarang, nama alat;
 * - **paket** seperti plugin Claude: berkas JSON `"type": "akai-package"` berisi instruksi tetap, skill (+ berkas), dan konektor MCP.
 */
import { SKILL_LIMITS, type SkillFile, validateSkill } from "../skills/skill-logic";

export const PLUGIN_LIMITS = {
  maxPlugins: 30,
  codeChars: 200_000,
  maxTools: 30,
  maxHosts: 20,
  maxConfig: 20,
  maxSkills: 10,
  /** Memori sandbox per eksekusi */
  memoryBytes: 32 * 1024 * 1024,
  /** Batas waktu satu pemanggilan alat (CPU + menunggu jaringan) */
  runMs: 30_000,
  /** Batas waktu memuat kode (definePlugin) */
  inspectMs: 2_000,
  maxFetches: 10,
  fetchTimeoutMs: 15_000,
  responseBytes: 1_000_000,
  resultChars: 20_000,
  logLines: 50,
  /** Paket: instruksi tetap per paket & jumlah konektor */
  instructionsChars: 4_000,
  maxConnectors: 5,
} as const;

export type PluginKind = "code" | "package";

/** Konektor MCP yang dibawa paket: preset `akasha` (alamat dari server) atau alamat MCP sendiri. */
export interface PackageConnector {
  name: string;
  preset: "akasha" | null;
  url: string | null;
  auth: "none" | "token";
  allowWrite: boolean;
  description: string;
}

export interface PluginConfigField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  description: string;
}

export interface PluginToolMeta {
  name: string;
  description: string;
  input: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
}

export interface PluginSkillMeta {
  name: string;
  description: string;
  instructions: string;
  files?: SkillFile[];
}

export interface PluginManifest {
  name: string;
  title: string;
  description: string;
  version: string;
  hosts: string[];
  config: PluginConfigField[];
  tools: PluginToolMeta[];
  skills: PluginSkillMeta[];
  kind: PluginKind;
  /** Paket: instruksi tetap yang ditambahkan ke prompt sistem selama paket menyala */
  instructions: string;
  connectors: PackageConnector[];
}

/** Manifest tersimpan → bentuk lengkap (manifest lama tanpa kind/instructions/connectors = plugin kode). */
export function normalizeManifest(raw: unknown): PluginManifest {
  const m = (isObject(raw) ? raw : {}) as Partial<PluginManifest>;
  return {
    name: m.name ?? "",
    title: m.title ?? m.name ?? "",
    description: m.description ?? "",
    version: m.version ?? "1.0.0",
    hosts: Array.isArray(m.hosts) ? m.hosts : [],
    config: Array.isArray(m.config) ? m.config : [],
    tools: Array.isArray(m.tools) ? m.tools : [],
    skills: Array.isArray(m.skills) ? m.skills : [],
    kind: m.kind === "package" ? "package" : "code",
    instructions: typeof m.instructions === "string" ? m.instructions : "",
    connectors: Array.isArray(m.connectors) ? m.connectors : [],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TOOL = /^[a-zA-Z0-9_-]{1,40}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
/** Host jaringan: nama domain (boleh awalan `*.`), tanpa skema, port, atau path. */
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Periksa & rapikan manifest mentah dari sandbox. Galat = pesan pertama yang bisa ditampilkan ke pemilik.
 * `localHosts` (khusus luar production / uji) mengizinkan `localhost` di daftar host.
 */
export function validateManifest(
  raw: unknown,
  localHosts = false,
): { manifest: PluginManifest; error: null } | { manifest: null; error: string } {
  const fail = (error: string) => ({ manifest: null, error }) as const;
  if (!isObject(raw)) return fail("Plugin wajib memanggil definePlugin({ ... }).");
  const name = str(raw.name, 40);
  if (!SLUG.test(name)) return fail("name wajib huruf kecil, angka, dan tanda hubung (maks. 40), mis. kurs-rupiah.");
  const title = str(raw.title, 80) || name;
  const description = str(raw.description, 1000);
  if (!description) return fail("description wajib diisi: apa yang dikerjakan plugin.");
  const version = str(raw.version, 20) || "1.0.0";

  const hostsRaw = raw.hosts === undefined ? [] : raw.hosts;
  if (!Array.isArray(hostsRaw)) return fail("hosts harus berupa daftar nama domain.");
  if (hostsRaw.length > PLUGIN_LIMITS.maxHosts) return fail(`Maks. ${PLUGIN_LIMITS.maxHosts} host.`);
  const hosts: string[] = [];
  for (const h of hostsRaw) {
    const host = str(h, 253).toLowerCase();
    if (!(HOST.test(host) || (localHosts && host === "localhost")))
      return fail(`Host tidak valid: ${String(h)} (tulis nama domain saja, mis. api.contoh.go.id).`);
    if (!hosts.includes(host)) hosts.push(host);
  }

  const configRaw = raw.config === undefined ? [] : raw.config;
  if (!Array.isArray(configRaw) || configRaw.length > PLUGIN_LIMITS.maxConfig)
    return fail(`config harus daftar isian (maks. ${PLUGIN_LIMITS.maxConfig}).`);
  const config: PluginConfigField[] = [];
  for (const c of configRaw) {
    if (!isObject(c) || !KEY.test(str(c.key, 40))) return fail("Setiap isian config wajib punya key (huruf/angka/_).");
    const key = str(c.key, 40);
    if (config.some((x) => x.key === key)) return fail(`Isian config ganda: ${key}`);
    config.push({
      key,
      label: str(c.label, 80) || key,
      secret: c.secret === true,
      required: c.required === true,
      description: str(c.description, 300),
    });
  }

  if (!Array.isArray(raw.tools) || raw.tools.length === 0)
    return fail("Plugin wajib punya minimal satu alat di tools.");
  if (raw.tools.length > PLUGIN_LIMITS.maxTools) return fail(`Maks. ${PLUGIN_LIMITS.maxTools} alat.`);
  const tools: PluginToolMeta[] = [];
  for (const t of raw.tools) {
    if (!isObject(t) || !TOOL.test(str(t.name, 40)))
      return fail("Setiap alat wajib punya name (huruf/angka/_/-, maks. 40).");
    const toolName = str(t.name, 40);
    if (tools.some((x) => x.name === toolName)) return fail(`Alat ganda: ${toolName}`);
    if (t.hasRun !== true) return fail(`Alat ${toolName} wajib punya fungsi run(input, akai).`);
    const toolDescription = str(t.description, 1000);
    if (!toolDescription) return fail(`Alat ${toolName} wajib punya description.`);
    const input = isObject(t.input) ? t.input : { type: "object", properties: {} };
    if (input.type !== "object") return fail(`input alat ${toolName} harus JSON Schema bertipe object.`);
    tools.push({
      name: toolName,
      description: toolDescription,
      input,
      readOnly: t.readOnly === true,
      destructive: t.destructive === true,
    });
  }

  const skillsRaw = raw.skills === undefined ? [] : raw.skills;
  if (!Array.isArray(skillsRaw) || skillsRaw.length > PLUGIN_LIMITS.maxSkills)
    return fail(`skills harus daftar (maks. ${PLUGIN_LIMITS.maxSkills}).`);
  const skills: PluginSkillMeta[] = [];
  for (const s of skillsRaw) {
    const skillName = isObject(s) ? str(s.name, 40) : "";
    if (!isObject(s) || !SLUG.test(skillName) || !str(s.description, 1024) || !str(s.instructions, 30_000))
      return fail("Setiap skill plugin wajib punya name (slug), description, dan instructions.");
    skills.push({ name: skillName, description: str(s.description, 1024), instructions: str(s.instructions, 30_000) });
  }

  return {
    manifest: {
      name,
      title,
      description,
      version,
      hosts,
      config,
      tools,
      skills,
      kind: "code",
      instructions: "",
      connectors: [],
    },
    error: null,
  };
}

/** Host URL termasuk daftar izin plugin? (`*.contoh.id` = subdomain apa pun, tidak termasuk contoh.id sendiri). */
export function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
}

/** Alamat IP jaringan lokal / khusus yang tidak boleh dijangkau plugin (cegah SSRF ke server Akai & jaringan internal). */
export function isPrivateAddress(ip: string) {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.replace(/^::ffff:/i, ""));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** Nama alat plugin untuk model: `p_<plugin>__<alat>` (≤ 64, karakter aman). */
export function pluginToolName(plugin: string, tool: string) {
  return `p_${plugin.replace(/-/g, "_")}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Boleh dipakai model di chat? Sama dengan konektor: baca selalu, ubah bila diizinkan, hapus tidak pernah. */
export const pluginToolAllowed = (t: Pick<PluginToolMeta, "readOnly" | "destructive">, allowWrite: boolean) =>
  !t.destructive && (t.readOnly || allowWrite);

/** Konfigurasi yang belum lengkap (isian wajib kosong) → daftar label. */
export const missingConfig = (fields: PluginConfigField[], values: Record<string, string>) =>
  fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.label);

/** Nilai konfigurasi untuk ditampilkan: rahasia diganti tanda (hanya tahu terisi atau tidak). */
export const publicConfig = (fields: PluginConfigField[], values: Record<string, string>) =>
  Object.fromEntries(fields.map((f) => [f.key, f.secret ? (values[f.key] ? "••••••" : "") : (values[f.key] ?? "")]));

/**
 * Prelude yang dijalankan di sandbox sebelum kode plugin: `definePlugin`, pembaca manifest, dan pemanggil alat dengan objek `akai`
 * (`akai.fetch`, `akai.config`, `akai.log`). Fungsi `__hostFetch` & `__hostLog` disediakan host (Akai).
 */
export const PRELUDE = `
var __plugin = null;
function definePlugin(p) {
  if (__plugin) throw new Error("definePlugin hanya boleh dipanggil sekali.");
  __plugin = p;
}
function __akaiManifest() {
  if (!__plugin || typeof __plugin !== "object") throw new Error("Plugin wajib memanggil definePlugin({ ... }).");
  var p = __plugin;
  var tools = Array.isArray(p.tools) ? p.tools : [];
  return JSON.stringify({
    name: p.name, title: p.title, description: p.description, version: p.version,
    hosts: p.hosts, config: p.config, skills: p.skills,
    tools: tools.map(function (t) {
      return t && typeof t === "object"
        ? { name: t.name, description: t.description, input: t.input, readOnly: t.readOnly === true,
            destructive: t.destructive === true, hasRun: typeof t.run === "function" }
        : null;
    })
  });
}
async function __akaiRun(name, inputJson, configJson) {
  var tools = (__plugin && Array.isArray(__plugin.tools)) ? __plugin.tools : [];
  var tool = null;
  for (var i = 0; i < tools.length; i++) if (tools[i] && tools[i].name === name) tool = tools[i];
  if (!tool) throw new Error("Alat tidak ada: " + name);
  var akai = Object.freeze({
    config: Object.freeze(JSON.parse(configJson)),
    log: function () {
      __hostLog(Array.prototype.map.call(arguments, function (a) { return typeof a === "string" ? a : JSON.stringify(a); }).join(" "));
    },
    fetch: async function (url, init) {
      var r = JSON.parse(await __hostFetch(String(url), JSON.stringify(init || {})));
      return {
        status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url, headers: r.headers,
        text: function () { return r.body; },
        json: function () { return JSON.parse(r.body); }
      };
    }
  });
  var out = await tool.run(JSON.parse(inputJson), akai);
  return typeof out === "string" ? out : JSON.stringify(out === undefined ? null : out, null, 2);
}
`;

/** Teks plugin berbentuk paket JSON? (plugin kode diawali komentar/kode JavaScript, paket diawali `{`) */
export const looksLikePackage = (text: string) => text.trimStart().startsWith("{");

/**
 * Periksa & rapikan paket JSON (`"type": "akai-package"`): nama, instruksi, skill (format sama dengan skill buatan pemilik, + berkas),
 * konektor (preset akasha atau alamat MCP; alamatnya diperiksa lagi oleh layanan konektor saat dipasang). Paket tidak menjalankan kode.
 */
export function validatePackage(
  text: string,
): { manifest: PluginManifest; error: null } | { manifest: null; error: string } {
  const fail = (error: string) => ({ manifest: null, error }) as const;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail(`Paket bukan JSON yang sah: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(raw) || raw.type !== "akai-package") return fail('Paket wajib berisi "type": "akai-package".');
  const name = str(raw.name, 40);
  if (!SLUG.test(name)) return fail("name wajib huruf kecil, angka, dan tanda hubung (maks. 40).");
  const description = str(raw.description, 1000);
  if (!description) return fail("description wajib diisi: apa isi paket ini.");
  const instructions = str(raw.instructions, PLUGIN_LIMITS.instructionsChars + 1);
  if (instructions.length > PLUGIN_LIMITS.instructionsChars)
    return fail(`instructions maks. ${PLUGIN_LIMITS.instructionsChars.toLocaleString("id-ID")} karakter.`);

  const skillsRaw = raw.skills === undefined ? [] : raw.skills;
  if (!Array.isArray(skillsRaw) || skillsRaw.length > PLUGIN_LIMITS.maxSkills)
    return fail(`skills harus daftar (maks. ${PLUGIN_LIMITS.maxSkills}).`);
  const skills: PluginSkillMeta[] = [];
  for (const s of skillsRaw) {
    if (!isObject(s)) return fail("Setiap skill wajib berupa objek { name, description, instructions, files? }.");
    const files = Array.isArray(s.files)
      ? s.files.map((f: unknown) => ({
          path: isObject(f) ? str(f.path, SKILL_LIMITS.pathChars + 1) : "",
          content: isObject(f) && typeof f.content === "string" ? f.content : "",
        }))
      : [];
    const skill = {
      name: str(s.name, 40),
      description: str(s.description, SKILL_LIMITS.descriptionChars + 1),
      instructions: typeof s.instructions === "string" ? s.instructions.trim() : "",
      files,
    };
    if (!SLUG.test(skill.name)) return fail(`Nama skill paket tidak valid: ${String(s.name)}`);
    if (skills.some((x) => x.name === skill.name)) return fail(`Skill ganda: ${skill.name}`);
    const error = validateSkill({ ...skill, name: `x-${skill.name}` });
    if (error) return fail(`Skill ${skill.name}: ${error}`);
    skills.push(skill);
  }

  const connRaw = raw.connectors === undefined ? [] : raw.connectors;
  if (!Array.isArray(connRaw) || connRaw.length > PLUGIN_LIMITS.maxConnectors)
    return fail(`connectors harus daftar (maks. ${PLUGIN_LIMITS.maxConnectors}).`);
  const connectors: PackageConnector[] = [];
  for (const c of connRaw) {
    if (!isObject(c)) return fail("Setiap konektor wajib berupa objek { name, url | preset, auth }.");
    const preset = c.preset === "akasha" ? "akasha" : null;
    if (c.preset !== undefined && !preset)
      return fail(`Preset konektor tidak dikenal: ${String(c.preset)} (yang ada: akasha).`);
    const url = preset ? null : str(c.url, 500);
    if (!preset && !url) return fail("Konektor tanpa preset wajib punya url (alamat MCP https).");
    const auth = preset ? "token" : c.auth === "token" ? "token" : "none";
    const connector: PackageConnector = {
      name: str(c.name, 60) || (preset === "akasha" ? "Akasha" : ""),
      preset,
      url,
      auth,
      allowWrite: c.allowWrite === true,
      description: str(c.description, 300),
    };
    if (!connector.name) return fail("Setiap konektor wajib punya name.");
    if (connectors.some((x) => (x.preset ?? x.url) === (connector.preset ?? connector.url)))
      return fail(`Konektor ganda: ${connector.preset ?? connector.url}`);
    connectors.push(connector);
  }
  if (!instructions && skills.length === 0 && connectors.length === 0)
    return fail("Paket kosong: isi minimal instructions, skills, atau connectors.");

  return {
    manifest: {
      name,
      title: str(raw.title, 80) || name,
      description,
      version: str(raw.version, 20) || "1.0.0",
      hosts: [],
      config: [],
      tools: [],
      skills,
      kind: "package",
      instructions,
      connectors,
    },
    error: null,
  };
}

/** Blok prompt sistem dari instruksi paket yang menyala (null = tidak ada). */
export function packageInstructionsBlock(items: { title: string; instructions: string }[]) {
  const used = items.filter((i) => i.instructions.trim());
  if (!used.length) return null;
  return [
    "INSTRUKSI PAKET yang dipasang pengguna (ikuti bila relevan; instruksi pengguna di percakapan tetap didahulukan):",
    ...used.map((i) => `<paket nama="${i.title.replace(/"/g, "'")}">\n${i.instructions.trim()}\n</paket>`),
  ].join("\n");
}
