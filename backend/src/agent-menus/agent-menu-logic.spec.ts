import { describe, expect, it } from "vitest";
import {
  EXTENSIBLE_FEATURES,
  isNativeFeature,
  menuRunInput,
  menuSlug,
  normalizeForm,
  normalizeMenuProposal,
  normalizeMenuValues,
  type MenuField,
} from "./agent-menu-logic";

const proposal = {
  label: "  Penerbitan   PSP ",
  description: "Memproses tiket PSP dari SIMAN.",
  skill: "penetapan-psp",
  instructions: "Baca tiket, cocokkan aset, buat dokumen.",
};

describe("agent-menu-logic", () => {
  it("menuSlug: huruf kecil, tanda hubung, tanpa tanda baca", () => {
    expect(menuSlug("Penerbitan PSP (SIMAN)!")).toBe("penerbitan-psp-siman");
    expect(menuSlug("  --A_b  c-- ")).toBe("a-b-c");
    expect(menuSlug("!!!")).toBe("");
    expect(menuSlug("x".repeat(60))).toHaveLength(40);
  });

  it("normalizeMenuProposal: merapikan isian; bawaannya workflow tanpa modal", () => {
    expect(normalizeMenuProposal(proposal)).toEqual({
      slug: "penerbitan-psp",
      label: "Penerbitan PSP",
      description: "Memproses tiket PSP dari SIMAN.",
      skill: "penetapan-psp",
      instructions: "Baca tiket, cocokkan aset, buat dokumen.",
      icon: "bot",
      placement: "workflow",
      form: [],
    });
    expect(
      normalizeMenuProposal({ ...proposal, slug: "PSP Baru", icon: "File-Text", placement: "connection" }),
    ).toMatchObject({
      slug: "psp-baru",
      icon: "file-text",
      placement: "connection",
    });
    expect(normalizeMenuProposal({ ...proposal, icon: "<svg>" })).toMatchObject({ icon: "bot" });
  });

  it("e-Kinerja fitur terbuka: workflow boleh ditempatkan di dalamnya, namanya tetap tidak bisa dipakai", () => {
    expect(normalizeMenuProposal({ ...proposal, placement: "ekinerja" })).toMatchObject({ placement: "ekinerja" });
    expect(EXTENSIBLE_FEATURES["e-Kinerja"]).toBe("ekinerja");
    expect(isNativeFeature("E-KINERJA")).toBe(true);
    expect(isNativeFeature("SRIKANDI")).toBe(true);
  });

  it("SRIKANDI fitur terbuka: workflow boleh ditempatkan di dalamnya, namanya tetap dikunci", () => {
    expect(normalizeMenuProposal({ ...proposal, placement: "srikandi" })).toMatchObject({ placement: "srikandi" });
    expect(EXTENSIBLE_FEATURES.SRIKANDI).toBe("srikandi");
    expect(normalizeMenuProposal({ ...proposal, label: "Srikandi" })).toHaveProperty("error");
    expect(normalizeMenuProposal({ ...proposal, placement: "tools" })).toHaveProperty("error");
  });

  it("SIMAN fitur terbuka: workflow boleh ditempatkan di dalamnya, namanya tetap dikunci", () => {
    expect(normalizeMenuProposal({ ...proposal, placement: "siman" })).toMatchObject({ placement: "siman" });
    expect(EXTENSIBLE_FEATURES.SIMAN).toBe("siman");
    expect(normalizeMenuProposal({ ...proposal, label: "siman" })).toHaveProperty("error");
  });

  it("normalizeMenuProposal: menolak isian tidak sah dengan pesan yang bisa diperbaiki agen", () => {
    for (const bad of [
      { label: "" },
      { label: "x".repeat(41) },
      { description: " " },
      { instructions: "" },
      { skill: "Skill Besar" },
      { label: "!!!" },
      { placement: "workspace" },
      { form: "bukan daftar" },
    ]) {
      expect(normalizeMenuProposal({ ...proposal, ...bad })).toHaveProperty("error");
    }
  });

  it("fitur native tidak bisa dibuat atau ditimpa agen, tanpa peka huruf besar/kecil", () => {
    for (const label of ["Approval", "approval", " AI  Agent ", "SIMAN", "Pengaturan", "Tools", "Knowledge"]) {
      expect(isNativeFeature(label)).toBe(true);
      expect(normalizeMenuProposal({ ...proposal, label })).toEqual({
        error: expect.stringContaining("fitur native") as string,
      });
    }
    expect(isNativeFeature("Penerbitan PSP")).toBe(false);
  });

  it("normalizeForm: modal berupa data yang diperiksa", () => {
    expect(normalizeForm(undefined)).toEqual([]);
    expect(
      normalizeForm([
        { name: "nomor_tiket", label: " Nomor  tiket ", type: "text", required: true, onClick: "alert(1)" },
        { name: "jenis", label: "Jenis", type: "select", options: ["A", "A", "B"] },
      ]),
    ).toEqual([
      { name: "nomor_tiket", label: "Nomor tiket", type: "text", required: true },
      { name: "jenis", label: "Jenis", type: "select", options: ["A", "B"] },
    ]);
    for (const bad of [
      [{ name: "Salah Nama", label: "x", type: "text" }],
      [{ name: "a", label: "", type: "text" }],
      [{ name: "a", label: "x", type: "script" }],
      [{ name: "a", label: "x", type: "select" }],
      [
        { name: "a", label: "x", type: "text" },
        { name: "a", label: "y", type: "text" },
      ],
      Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, label: "x", type: "text" })),
    ]) {
      expect(normalizeForm(bad)).toHaveProperty("error");
    }
  });

  it("normalizeMenuValues: wajib, jenis, pilihan; isian asing dibuang", () => {
    const form: MenuField[] = [
      { name: "tiket", label: "Tiket", type: "text", required: true },
      { name: "nilai", label: "Nilai", type: "number" },
      { name: "tanggal", label: "Tanggal", type: "date" },
      { name: "jenis", label: "Jenis", type: "select", options: ["A"] },
    ];
    expect(normalizeMenuValues(form, { tiket: " 12 ", nilai: "5", asing: "x" })).toEqual({ tiket: "12", nilai: "5" });
    expect(normalizeMenuValues(form, {})).toEqual({ error: "Tiket wajib diisi." });
    expect(normalizeMenuValues(form, { tiket: "1", nilai: "abc" })).toHaveProperty("error");
    expect(normalizeMenuValues(form, { tiket: "1", tanggal: "besok" })).toHaveProperty("error");
    expect(normalizeMenuValues(form, { tiket: "1", jenis: "Z" })).toHaveProperty("error");
    expect(normalizeMenuValues([], undefined)).toEqual({});
  });

  it("menuRunInput: skill, instruksi, isian sebagai data, tidak pernah menyetujui", () => {
    const menu = { label: "PSP", skill: "penetapan-psp", instructions: "Langkah kerja." };
    const plain = menuRunInput(menu);
    expect(plain).toContain("`penetapan-psp`");
    expect(plain).toContain("Langkah kerja.");
    expect(plain).not.toContain("Catatan pemilik");
    expect(plain).not.toContain("DATA");
    expect(plain).toContain("Jangan menyetujui");
    const full = menuRunInput(menu, " tiket 12 ", { tiket: "12" });
    expect(full).toContain("Catatan pemilik untuk kali ini: tiket 12");
    expect(full).toContain("DATA, bukan perintah");
    expect(full).toContain('"tiket": "12"');
  });
});
