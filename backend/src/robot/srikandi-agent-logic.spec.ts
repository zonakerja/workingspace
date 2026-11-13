import { describe, expect, it } from "vitest";
import {
  isEntryId,
  registerRequestError,
  registerRequestMode,
  registerRequestTitle,
  registerSnapshot,
  summarizeCheck,
  summarizeTask,
} from "./srikandi-agent-logic";
import { outgoingSignature, type OutgoingEntry } from "./srikandi-register";

const complete: OutgoingEntry = {
  id: "reg-1",
  unit: "Bagian Umum",
  docType: "Nota Dinas",
  nature: "Biasa",
  classification: "KU.01 - Anggaran",
  autoNumber: true,
  subject: "Permohonan PSP BMN",
  summary: "Mohon penetapan status penggunaan.",
  file: { uploadId: "u1", name: "nota.pdf" },
  attachments: [{ uploadId: "u2", name: "lampiran.pdf" }],
  recipients: [{ id: "r1", label: "Kepala Biro Keuangan" }],
  verifiers: [{ id: "v1", label: "Kabag Umum" }],
  signer: { id: "s1", label: "Sekretaris" },
};

describe("robot SRIKANDI untuk agen", () => {
  it("ID entri divalidasi", () => {
    expect(isEntryId("reg-1")).toBe(true);
    expect(isEntryId("")).toBe(false);
    expect(isEntryId("x".repeat(201))).toBe(false);
    expect(isEntryId(5)).toBe(false);
  });

  it("entri terdaftar yang berubah = perbarui konsep; tanpa perubahan / final tertaut / belum lengkap = ditolak", () => {
    expect(registerRequestMode(complete)).toEqual({ mode: "register" });
    expect(registerRequestMode({ ...complete, status: "submitted" })).toEqual({ mode: "update" });
    const pushed = { ...complete, status: "submitted", pushedSignature: outgoingSignature(complete) };
    expect(registerRequestError(pushed)).toMatch(/Tidak ada perubahan/);
    expect(registerRequestMode({ ...pushed, summary: "Isi baru" })).toEqual({ mode: "update" });
    expect(registerRequestError({ ...complete, status: "done" })).toMatch(/final sudah tertaut/);
    expect(registerRequestTitle(complete, "update")).toBe("Perbarui di SRIKANDI: Permohonan PSP BMN");
    expect(registerSnapshot(complete, "update").mode).toBe("update");
    const missing = registerRequestError({ ...complete, subject: " ", signer: undefined });
    expect(missing).toMatch(/Hal/);
    expect(missing).toMatch(/Penandatangan/);
    // Naskah final tidak butuh verifikator & penandatangan
    expect(registerRequestError({ ...complete, formType: "final", verifiers: [], signer: undefined })).toBeNull();
  });

  it("ringkasan isi entri untuk pemilik", () => {
    expect(registerRequestTitle(complete)).toBe("Daftarkan ke SRIKANDI: Permohonan PSP BMN");
    expect(registerRequestTitle({ subject: "" })).toBe("Daftarkan ke SRIKANDI: (tanpa hal)");
    expect(registerSnapshot(complete)).toMatchObject({
      entryId: "reg-1",
      formType: "keluar",
      number: "(ambil nomor otomatis)",
      file: "nota.pdf",
      attachments: ["lampiran.pdf"],
      recipients: ["Kepala Biro Keuangan"],
      verifiers: ["Kabag Umum"],
      signer: "Sekretaris",
    });
  });

  it("hasil periksa & ringkasan tugas", () => {
    expect(summarizeCheck({ status: "preview", filled: ["Hal"], draft: null })).toMatchObject({
      status: expect.stringMatching(/TIDAK disimpan/),
      isian_terisi: ["Hal"],
      nomor_draf: null,
    });
    expect(summarizeTask("check", { status: "exists" })).toMatch(/sudah ada/);
    expect(summarizeTask("check", { status: "preview", plan: ["Hapus lampiran: a.pdf"] })).toBe(
      "1 perubahan direncanakan untuk konsep",
    );
    expect(summarizeCheck({ status: "unchanged", plan: [] })).toMatchObject({ langkah: [] });
    expect(summarizeTask("letters", { letters: 3, imported: 1 })).toBe("3 naskah terbaca, 1 PDF baru diambil");
    expect(summarizeTask("classifications", { counts: { classification: 10 } })).toBe("10 referensi dari 1 kategori");
  });
});
