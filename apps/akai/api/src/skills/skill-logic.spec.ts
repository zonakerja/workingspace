import { describe, expect, it } from "vitest";
import { BUILTIN_SKILLS } from "./builtin-skills";
import {
  SKILL_TOOL,
  cleanFilePath,
  inlineSkills,
  parseSkillMd,
  pickSkills,
  skillCatalog,
  skillSlug,
  skillToolDefinition,
  skillToolResult,
  toSkillMd,
  validateSkill,
} from "./skill-logic";

const base = {
  name: "surat-undangan",
  description: "Membuat surat undangan rapat",
  instructions: "Langkah 1",
  files: [],
};

describe("skill-logic", () => {
  it("membaca SKILL.md: satu baris, berkutip, blok terlipat; tanpa frontmatter = instruksi saja", () => {
    expect(
      parseSkillMd('---\nname: telaah\ndescription: "Telaah: pengajuan"\nversion: 2\n---\n\n# Judul\nIsi'),
    ).toEqual({
      name: "telaah",
      description: "Telaah: pengajuan",
      instructions: "# Judul\nIsi",
    });
    const folded = parseSkillMd("---\r\nname: a\r\ndescription: >-\r\n  baris satu\r\n  baris dua\r\n---\r\nX");
    expect(folded.description).toBe("baris satu baris dua");
    expect(folded.instructions).toBe("X");
    expect(parseSkillMd("Hanya instruksi")).toEqual({ instructions: "Hanya instruksi" });
  });

  it("menulis SKILL.md yang bisa dibaca ulang", () => {
    const text = toSkillMd({ ...base, description: 'Pakai "kutip"\nbaru' });
    expect(parseSkillMd(text)).toEqual({
      name: base.name,
      description: 'Pakai "kutip" baru',
      instructions: "Langkah 1",
    });
  });

  it("nama & path berkas dibersihkan", () => {
    expect(skillSlug("Surat Undangan Rapat!")).toBe("surat-undangan-rapat");
    expect(cleanFilePath("\\contoh/templat.md")).toBe("contoh/templat.md");
    expect(cleanFilePath("../rahasia")).toBeNull();
    expect(cleanFilePath("a//b")).toBeNull();
  });

  it("validasi: nama, awalan bawaan, deskripsi, berkas", () => {
    expect(validateSkill(base)).toBeNull();
    expect(validateSkill({ ...base, name: "Surat" })).toMatch(/huruf kecil/);
    expect(validateSkill({ ...base, name: "akai-x" })).toMatch(/bawaan/);
    expect(validateSkill({ ...base, description: " " })).toMatch(/Deskripsi/);
    expect(validateSkill({ ...base, files: [{ path: "SKILL.md", content: "" }] })).toMatch(/SKILL.md/);
    expect(
      validateSkill({
        ...base,
        files: [
          { path: "a.md", content: "" },
          { path: "a.md", content: "" },
        ],
      }),
    ).toMatch(/ganda/);
  });

  it("katalog, alat, dan hasil alat", () => {
    expect(skillCatalog([])).toBeNull();
    expect(skillCatalog([base])).toContain("- surat-undangan: Membuat surat undangan rapat");
    expect(skillToolDefinition(["a"]).function.name).toBe(SKILL_TOOL);
    const skill = { ...base, files: [{ path: "contoh.md", content: "CONTOH" }] };
    expect(skillToolResult(skill).text).toContain("<berkas_pendukung>\n- contoh.md");
    expect(skillToolResult(skill, "contoh.md")).toEqual({ isError: false, text: "CONTOH" });
    expect(skillToolResult(skill, "lain.md").isError).toBe(true);
    expect(skillToolResult(undefined).isError).toBe(true);
  });

  it("cadangan tanpa alat: pilih skill menurut kata kunci", () => {
    const skills = [base, { ...base, name: "notulen", description: "Menyusun notulen risalah rapat" }];
    expect(pickSkills(skills, "Tolong buatkan surat undangan untuk rapat koordinasi").map((s) => s.name)).toEqual([
      "surat-undangan",
    ]);
    expect(pickSkills(skills, "halo apa kabar")).toEqual([]);
    expect(inlineSkills([])).toBeNull();
    expect(inlineSkills([base])).toContain('<skill name="surat-undangan">');
  });

  it("skill bawaan sah dan berawalan akai-", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    for (const s of BUILTIN_SKILLS) {
      expect(s.name.startsWith("akai-")).toBe(true);
      expect(validateSkill({ ...s, name: s.name.replace(/^akai-/, "x-") })).toBeNull();
    }
  });
});
