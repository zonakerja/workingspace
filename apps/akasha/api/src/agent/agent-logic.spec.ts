import { describe, expect, it } from "vitest";
import {
  conversationTitle,
  isAgentOwner,
  runsToMessages,
  parseRun,
  parseSkillFile,
  parseSkills,
  sessionIdFor,
  SKILL_NAME,
  skillRunInput,
} from "./agent-logic";

describe("agent-logic", () => {
  it("perintah skill memuat ID & judul pengajuan dan larangan memutuskan", () => {
    const input = skillRunInput("telaah-pengajuan", { id: "req1", title: "PSP\n laptop" });
    expect(input).toContain("`telaah-pengajuan`");
    expect(input).toContain("ID pengajuan: req1");
    expect(input).toContain("Judul: PSP laptop");
    expect(input).toMatch(/Jangan menyetujui/);
  });

  it("nama skill", () => {
    expect(SKILL_NAME.test("penetapan-psp")).toBe(true);
    expect(SKILL_NAME.test("../etc")).toBe(false);
    expect(SKILL_NAME.test("Telaah")).toBe(false);
  });

  it("daftar skill: skill Akasha di atas, bentuk respons berbeda", () => {
    const body = [
      { name: "github-pr-workflow", description: "x", category: "github" },
      { name: "telaah-pengajuan", description: "Telaah", category: "akasha" },
      { description: "tanpa nama" },
    ];
    expect(parseSkills(body).map((s) => [s.name, s.akasha])).toEqual([
      ["telaah-pengajuan", true],
      ["github-pr-workflow", false],
    ]);
    expect(parseSkills({ data: body })).toHaveLength(2);
    expect(parseSkills({ skills: body })).toHaveLength(2);
    expect(parseSkills(null)).toEqual([]);
  });

  it("status run: selesai, berjalan, gagal, output item", () => {
    expect(parseRun("r1", { status: "completed", output: "Done." })).toEqual({
      runId: "r1",
      status: "completed",
      done: true,
      output: "Done.",
      error: null,
    });
    expect(parseRun("r1", { status: "running" }).done).toBe(false);
    expect(parseRun("r1", {}).status).toBe("unknown");
    expect(parseRun("r1", { status: "failed" }).error).toMatch(/gagal/);
    expect(parseRun("r1", { status: "failed", error: { message: "kuota" } }).error).toBe("kuota");
    expect(parseRun("r1", { status: "completed", output: [{ content: [{ text: "Halo" }] }] }).output).toBe("Halo");
  });

  it("pemilik & ID sesi", () => {
    expect(isAgentOwner("Admin@WorkingSpace.id ", "admin@workingspace.id")).toBe(true);
    expect(isAgentOwner(undefined, "admin@workingspace.id")).toBe(false);
    expect(isAgentOwner("a@x.com", "b@x.com")).toBe(false);
    expect(sessionIdFor("u1", "abc-1!")).toBe("akasha-u1-abc-1");
    expect(sessionIdFor("u1", "")).toBe("akasha-u1-utama");
  });
});

describe("parseSkillFile", () => {
  it("membaca frontmatter SKILL.md", () => {
    const text = "---\nname: telaah-pengajuan\ndescription: Menelaah pengajuan.\n---\n\n# Isi";
    expect(parseSkillFile(text, "x")).toEqual({
      name: "telaah-pengajuan",
      description: "Menelaah pengajuan.",
      category: "akasha",
      akasha: true,
    });
    expect(parseSkillFile("---\ndescription: tanpa nama\n---", "folder-ku")?.name).toBe("folder-ku");
    expect(parseSkillFile("# tanpa frontmatter", "x")).toBeNull();
    expect(parseSkillFile("---\nname: Nama Salah\n---", "x")).toBeNull();
  });
});

describe("riwayat percakapan", () => {
  it("judul dari pesan pertama, dipotong di batas kata", () => {
    expect(conversationTitle("  Halo   agen\n apa kabar ")).toBe("Halo agen apa kabar");
    expect(conversationTitle("")).toBe("Percakapan baru");
    const long = conversationTitle(
      "Tolong telaah pengajuan penetapan status penggunaan barang milik negara dari satker",
    );
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
  });

  it("tugas → pesan user + jawaban agen", () => {
    const at = new Date("2026-11-18T01:00:00Z");
    const msgs = runsToMessages([
      {
        id: "r1",
        hermesRunId: "h1",
        input: "Halo",
        status: "completed",
        output: "Hai",
        error: null,
        createdAt: at,
        finishedAt: at,
      },
      {
        id: "r2",
        hermesRunId: null,
        input: "Lagi",
        status: "running",
        output: null,
        error: null,
        createdAt: at,
        finishedAt: null,
      },
      {
        id: "r3",
        hermesRunId: "h3",
        input: "x",
        status: "failed",
        output: null,
        error: "Gagal",
        createdAt: at,
        finishedAt: at,
      },
    ]);
    expect(msgs.map((m) => [m.role, m.text, m.status])).toEqual([
      ["user", "Halo", undefined],
      ["agent", "Hai", "done"],
      ["user", "Lagi", undefined],
      ["agent", "", "running"],
      ["user", "x", undefined],
      ["agent", "Gagal", "error"],
    ]);
    expect(msgs[3].runId).toBe("r2");
  });
});
