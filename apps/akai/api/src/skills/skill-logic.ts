/**
 * Aturan Skill Akai (6b.6, docs/AKAI.md §8). Logika murni, diuji di skill-logic.spec.ts: membaca & menulis format SKILL.md (sama
 * dengan skill Hermes: frontmatter `name` + `description`, lalu instruksi Markdown), batas isi, katalog untuk prompt sistem, alat
 * `akai__skill` untuk memuat skill, dan pemilihan cadangan menurut kata kunci bila model tidak mendukung alat.
 */

export const SKILL_LIMITS = {
  /** Skill buatan pemilik per akun */
  maxSkills: 50,
  nameChars: 64,
  descriptionChars: 1024,
  instructionsChars: 30_000,
  maxFiles: 10,
  fileChars: 50_000,
  pathChars: 120,
} as const;

/** Nama alat yang dipakai model untuk memuat skill (awalan `akai__` tidak bentrok dengan slug konektor, maks. 20 huruf + `__`). */
export const SKILL_TOOL = "akai__skill";

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillDef {
  name: string;
  description: string;
  instructions: string;
  files: SkillFile[];
}

/** Nama skill: huruf kecil, angka, tanda hubung (seperti nama folder skill Hermes). */
export function skillSlug(raw: string) {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_LIMITS.nameChars);
}

const unquote = (v: string) => {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
};

/**
 * Baca teks SKILL.md: frontmatter `---` berisi `name` & `description` (satu baris, berkutip, atau blok `>`/`|`), sisanya instruksi.
 * Tanpa frontmatter = seluruh teks instruksi. Kunci lain di frontmatter diabaikan.
 */
export function parseSkillMd(text: string): Partial<SkillDef> & { instructions: string } {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!match) return { instructions: src.trim() };
  const fields: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let value = m[2];
    if (/^[>|][-+]?$/.test(value.trim())) {
      const folded = value.trim().startsWith(">");
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === ""))
        block.push(lines[++i].trim());
      value = folded ? block.join(" ").replace(/\s+/g, " ") : block.join("\n");
    }
    fields[key] = unquote(value).trim();
  }
  return {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    instructions: match[2].trim(),
  };
}

/** Tulis skill sebagai teks SKILL.md (untuk diunduh / dipakai di Hermes). */
export function toSkillMd(skill: Pick<SkillDef, "name" | "description" | "instructions">) {
  const description = skill.description.replace(/\s+/g, " ").trim();
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${skill.instructions.trim()}\n`;
}

/** Path berkas pendukung: relatif, tanpa `..`, karakter aman; null = ditolak. */
export function cleanFilePath(raw: string) {
  const path = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!path || path.length > SKILL_LIMITS.pathChars) return null;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (!/^[\w.\- /]+$/.test(path)) return null;
  return path;
}

/** Periksa skill (nama, deskripsi, instruksi, berkas); kembalikan pesan galat pertama atau null. */
export function validateSkill(skill: SkillDef): string | null {
  if (!skill.name || skill.name !== skillSlug(skill.name))
    return "Nama skill hanya huruf kecil, angka, dan tanda hubung (mis. surat-undangan).";
  if (skill.name.startsWith("akai-")) return "Awalan akai- dipakai skill bawaan.";
  if (!skill.description.trim()) return "Deskripsi wajib diisi: kapan skill ini dipakai.";
  if (skill.description.length > SKILL_LIMITS.descriptionChars)
    return `Deskripsi maks. ${SKILL_LIMITS.descriptionChars} karakter.`;
  if (!skill.instructions.trim()) return "Instruksi skill kosong.";
  if (skill.instructions.length > SKILL_LIMITS.instructionsChars)
    return `Instruksi maks. ${SKILL_LIMITS.instructionsChars.toLocaleString("id-ID")} karakter.`;
  if (skill.files.length > SKILL_LIMITS.maxFiles) return `Maks. ${SKILL_LIMITS.maxFiles} berkas pendukung.`;
  const seen = new Set<string>();
  for (const file of skill.files) {
    const path = cleanFilePath(file.path);
    if (!path) return `Nama berkas tidak valid: ${file.path}`;
    if (path.toLowerCase() === "skill.md") return "SKILL.md adalah instruksi skill, bukan berkas pendukung.";
    if (seen.has(path)) return `Berkas ganda: ${path}`;
    seen.add(path);
    if (file.content.length > SKILL_LIMITS.fileChars)
      return `Berkas ${path} maks. ${SKILL_LIMITS.fileChars.toLocaleString("id-ID")} karakter.`;
  }
  return null;
}

/** Bagian prompt sistem: daftar skill yang tersedia (nama + deskripsi) + aturan memuat. Tanpa skill = null. */
export function skillCatalog(skills: Pick<SkillDef, "name" | "description">[]) {
  if (!skills.length) return null;
  return [
    "SKILL: Anda punya skill — kumpulan instruksi khusus milik pengguna/Akai untuk pekerjaan tertentu:",
    "<skill_tersedia>",
    ...skills.map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").trim()}`),
    "</skill_tersedia>",
    `Bila permintaan pengguna cocok dengan deskripsi sebuah skill, panggil alat ${SKILL_TOOL} dengan nama skill itu SEBELUM menjawab, lalu ikuti instruksinya (instruksi pengguna di percakapan tetap didahulukan). Jangan memuat skill yang tidak relevan, dan jangan menyebut nama skill bila tidak perlu.`,
  ].join("\n");
}

/** Definisi alat format OpenAI untuk memuat skill / membaca berkas pendukungnya. */
export function skillToolDefinition(names: string[]) {
  return {
    type: "function",
    function: {
      name: SKILL_TOOL,
      description:
        "[Akai] Muat instruksi lengkap sebuah skill dari daftar <skill_tersedia>. Isi `file` untuk membaca berkas pendukung yang disebut di instruksi skill.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", enum: names, description: "Nama skill" },
          file: { type: "string", description: "Opsional: path berkas pendukung skill" },
        },
        required: ["name"],
      },
    },
  };
}

/** Hasil alat skill untuk model: instruksi (+ daftar berkas) atau isi satu berkas. */
export function skillToolResult(skill: SkillDef | undefined, file?: unknown): { isError: boolean; text: string } {
  if (!skill) return { isError: true, text: "Skill tidak ditemukan atau sedang dimatikan." };
  if (typeof file === "string" && file.trim()) {
    const path = cleanFilePath(file);
    const found = path ? skill.files.find((f) => f.path === path) : undefined;
    if (!found)
      return {
        isError: true,
        text: `Berkas tidak ada di skill ${skill.name}. Berkas yang ada: ${skill.files.map((f) => f.path).join(", ") || "(tidak ada)"}`,
      };
    return { isError: false, text: found.content };
  }
  const files = skill.files.length
    ? `\n\n<berkas_pendukung>\n${skill.files.map((f) => `- ${f.path}`).join("\n")}\n</berkas_pendukung>\nBaca berkas di atas dengan alat ${SKILL_TOOL} (isi \`file\`) hanya bila instruksi membutuhkannya.`
    : "";
  return { isError: false, text: `<skill name="${skill.name}">\n${skill.instructions}\n</skill>${files}` };
}

const WORD = /[a-z0-9]+/g;
const STOP = new Set(
  "yang dan atau untuk dengan dari pada dalam ini itu ke di saya anda akan bisa tolong buat buatkan apa ada juga lebih agar oleh sebagai the and for to of a an is in on with".split(
    " ",
  ),
);
const words = (text: string) =>
  new Set(
    (
      text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .match(WORD) ?? []
    ).filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * Cadangan tanpa alat (model tidak mendukung tools): pilih maks. `max` skill yang kata kuncinya (nama + deskripsi) paling banyak
 * muncul di pesan pengguna. Kata dicocokkan juga lewat awalan 5 huruf (surat ~ suratnya). Minimal 2 kata cocok.
 */
export function pickSkills<T extends Pick<SkillDef, "name" | "description">>(
  skills: T[],
  message: string,
  max = 2,
): T[] {
  const asked = words(message);
  if (!asked.size) return [];
  const stems = new Set([...asked].map((w) => w.slice(0, 5)));
  return skills
    .map((skill) => {
      const keys = words(`${skill.name.replace(/-/g, " ")} ${skill.description}`);
      let score = 0;
      for (const k of keys) if (asked.has(k) || stems.has(k.slice(0, 5))) score++;
      return { skill, score };
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.skill);
}

/** Blok instruksi skill yang disisipkan langsung ke prompt sistem (jalur cadangan tanpa alat). */
export const inlineSkills = (skills: SkillDef[]) =>
  skills.length
    ? `SKILL yang dipakai untuk permintaan ini (ikuti bila relevan):\n${skills.map((s) => skillToolResult(s).text).join("\n\n")}`
    : null;
