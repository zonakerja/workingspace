/** Klien Skill Akai (6b.6, docs/AKAI.md §8). */
import { request } from "./api";

export interface SkillFileRef {
  path: string;
  size: number;
}

export interface SkillItem {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  files: SkillFileRef[];
  enabled: boolean;
  builtin: boolean;
  updatedAt: string | null;
}

export interface SkillDetail extends SkillItem {
  id: string;
  fileContents: { path: string; content: string }[];
  skillMd: string;
}

export interface SkillList {
  builtin: SkillItem[];
  custom: SkillItem[];
}

export interface SkillInput {
  skillMd?: string;
  name?: string;
  description?: string;
  instructions?: string;
  files?: { path: string; content: string }[];
  enabled?: boolean;
}

export const skillsApi = {
  list: () => request<SkillList>("GET", "/api/skills"),
  get: (id: string) => request<SkillDetail>("GET", `/api/skills/${id}`),
  create: (input: SkillInput) => request<SkillDetail>("POST", "/api/skills", input),
  update: (id: string, input: SkillInput) => request<SkillDetail>("PATCH", `/api/skills/${id}`, input),
  remove: (id: string) => request<void>("DELETE", `/api/skills/${id}`),
  setBuiltin: (name: string, enabled: boolean) =>
    request<SkillList>("PATCH", `/api/skills/builtin/${encodeURIComponent(name)}`, { enabled }),
};

/** Batas isi (sama dengan SKILL_LIMITS di apps/akai/api/src/skills/skill-logic.ts — ubah bersamaan). */
export const SKILL_LIMITS = { descriptionChars: 1024, instructionsChars: 30_000, maxFiles: 10, fileChars: 50_000 };

/** Nama skill: huruf kecil, angka, tanda hubung (salinan `skillSlug` API). */
export function skillSlug(raw: string) {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Unduh teks sebagai berkas di browser. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ekstensi berkas pendukung yang dibaca sebagai teks. */
export const SKILL_FILE_ACCEPT = ".md,.txt,.csv,.json,.yaml,.yml,.html,.xml,.py,.js,.ts,.sql";
