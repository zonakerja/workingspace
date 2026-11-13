import { describe, expect, it } from "vitest";
import {
  describePlan,
  type EditState,
  fileKey,
  isRowRemovalConfirm,
  parseUpdateForm,
  planEdit,
  planIsEmpty,
  recipientMenu,
  sameParty,
  type UpdateForm,
} from "./srikandi-register-edit";

const state: EditState = {
  unit: "Bagian Keuangan Setditjen Hubud",
  docType: "Nota Dinas",
  nature: "Biasa",
  classification: "KU.204 - Laporan Keuangan",
  number: "XXX/KEU/ND/2026",
  subject: "[UJI] Hal lama",
  summary: "Isi ringkas",
  signatureType: "elektronik",
  visualTte: "qr",
  fileName: "nota.pdf",
  attachments: ["lampiran_1.pdf"],
  recipients: [{ name: "Enie Kurniawati - Tata Usaha/Sekretaris Kepala Bagian Keuangan", kind: "UTAMA" }],
  verifiers: ["Enie Kurniawati - Tata Usaha/Sekretaris Kepala Bagian Keuangan"],
  signers: ["Arif Priyo Utomo - Kepala Bagian Keuangan"],
};

const form: UpdateForm = {
  formType: "keluar",
  unit: "Bagian Keuangan Setditjen Hubud",
  docType: "Nota Dinas",
  nature: "Biasa",
  classification: "KU.204 - Laporan Keuangan",
  autoNumber: true,
  subject: "[UJI] Hal lama",
  summary: "Isi ringkas",
  attachments: [{ name: "lampiran_1.pdf", mimeType: "application/pdf", data: "AA==" }],
  recipientGroups: [],
  recipients: [{ label: "Enie Kurniawati - Tata Usaha/Sekretaris Kepala Bagian Keuangan - Kementerian Perhubungan" }],
  recipientsExternal: [],
  ccGroups: [],
  cc: [],
  ccExternal: [],
  verifiers: [{ label: "Enie Kurniawati", hint: "Tata Usaha" }],
  signer: { label: "Arif Priyo Utomo", hint: "Kepala Bagian Keuangan" },
  signatureType: "elektronik",
  visualTte: "qr",
  findSubject: "[UJI] Hal lama",
};

describe("Edit konsep di Log Naskah Keluar", () => {
  it("tidak ada perubahan bila isi sama (nama/kode dicocokkan tanpa jabatan & instansi)", () => {
    const plan = planEdit(form, state);
    expect(planIsEmpty(plan)).toBe(true);
    expect(describePlan(plan)).toEqual([]);
    expect(sameParty("Enie Kurniawati - Tata Usaha", { label: "Enie Kurniawati" })).toBe(true);
    expect(fileKey("Lampiran_1.PDF")).toBe("lampiran1");
  });

  it("hanya yang berbeda diubah: bagian atas, lampiran, tujuan, verifikator, penandatangan", () => {
    const plan = planEdit(
      {
        ...form,
        subject: "[UJI] Hal baru",
        nature: "Terbatas",
        attachments: [{ name: "data_baru.xlsx", mimeType: "x", data: "AA==" }],
        cc: [{ label: "Budi - Kepala Subbagian" }],
        verifiers: [{ label: "Siti Aminah" }],
        signer: { label: "Krisna Dia Pranata" },
        file: { name: "nota-v2.pdf", mimeType: "application/pdf", data: "AA==" },
      },
      state,
    );
    expect(plan.top).toEqual(["Sifat Naskah", "Hal", "File naskah"]);
    expect(plan.replaceFile).toBe(true);
    expect(plan.attachmentsAdd.map((a) => a.name)).toEqual(["data_baru.xlsx"]);
    expect(plan.attachmentsRemove).toEqual(["lampiran_1.pdf"]);
    expect(plan.recipientsAdd).toEqual([{ slot: "tembusan", pick: { label: "Budi - Kepala Subbagian" } }]);
    expect(plan.recipientsRemove).toEqual([]);
    expect(plan.verifiersAdd).toEqual([{ label: "Siti Aminah" }]);
    expect(plan.verifiersRemove).toEqual([state.verifiers[0]]);
    expect(plan.signerAdd).toEqual({ label: "Krisna Dia Pranata" });
    expect(plan.signersRemove).toEqual([state.signers[0]]);
    expect(describePlan(plan)[0]).toBe("Perbarui Naskah: Sifat Naskah, Hal, File naskah");
  });

  it("tujuan yang dilepas dihapus, kecuali entri memakai grup (SRIKANDI memecah grup menjadi anggota)", () => {
    const other = { ...form, recipients: [{ label: "Budi" }] };
    expect(planEdit(other, state).recipientsRemove).toEqual([state.recipients[0].name]);
    const grouped = planEdit({ ...other, recipientGroups: [{ label: "Satker BLU" }] }, state);
    expect(grouped.recipientsRemove).toEqual([]);
    expect(grouped.warnings[0]).toMatch(/Grup Tujuan/);
  });

  it("Ambil Nomor tidak mengubah nomor yang sudah ada; nomor manual dibandingkan", () => {
    expect(planEdit(form, state).top).not.toContain("Nomor Naskah");
    expect(planEdit({ ...form, autoNumber: false, number: "12/KEU/2026" }, state).top).toContain("Nomor Naskah");
  });

  it("konfirmasi hapus hanya untuk baris di halaman Edit", () => {
    const edit = "https://srikandi.arsip.go.id/pembuatan-naskah-keluar/log-naskah-keluar/form?id=x&formode=Ubah";
    expect(isRowRemovalConfirm(edit, "Data Enie Kurniawati akan dihapus ?")).toBe(true);
    expect(isRowRemovalConfirm(edit, "Log Naskah XXX/KEU akan dihapus?")).toBe(false);
    expect(isRowRemovalConfirm(edit, "Data Log Naskah akan dihapus ?")).toBe(false);
    const log = "https://srikandi.arsip.go.id/pembuatan-naskah-keluar/log-naskah-keluar";
    expect(isRowRemovalConfirm(log, "Data Enie akan dihapus ?")).toBe(false);
  });

  it("menu Tambah tujuan & validasi masukan", () => {
    expect(recipientMenu("tembusan_eksternal")).toEqual({ parent: "Tembusan", child: "Eksternal Non Srikandi" });
    expect(recipientMenu("utama")).toEqual({ parent: "Tujuan Utama", child: "Internal/Eksternal Srikandi" });
    expect(parseUpdateForm({ ...form, findSubject: "" })).toEqual({ error: "Hal konsep di SRIKANDI wajib." });
    const ok = parseUpdateForm({ ...form, recipients: form.recipients });
    expect("form" in ok && ok.form.file).toBeUndefined();
    expect("form" in ok && ok.form.findSubject).toBe("[UJI] Hal lama");
  });
});

describe("mencari konsep di Log", () => {
  it("hal lama dulu, lalu hal baru (Perbarui terhenti di tengah); baris bertautan Edit diutamakan", async () => {
    const { findEditRow } = await import("./srikandi-register-edit");
    const rows = [
      { subject: "Hal A", editHref: null },
      { subject: "Hal A", editHref: "/form?id=1&formode=Ubah" },
      { subject: "Hal B", editHref: "/form?id=2&formode=Ubah" },
    ];
    expect(findEditRow(rows, "hal a", "Hal B")?.editHref).toBe("/form?id=1&formode=Ubah");
    expect(findEditRow(rows, "Hal lama", "Hal B")?.editHref).toBe("/form?id=2&formode=Ubah");
    expect(findEditRow(rows, "X", "Y")).toBeNull();
  });
});
