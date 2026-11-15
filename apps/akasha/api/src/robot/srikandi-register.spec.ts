import { describe, expect, it } from "vitest";
import {
  buildRegisterFields,
  sendBlockers,
  cleanAttachmentName,
  outgoingSignature,
  registerBlockers,
  registerSizeError,
  type OutgoingEntry,
} from "./srikandi-register";

const entry: OutgoingEntry = {
  id: "reg-1",
  formType: "keluar",
  unit: "Bagian Keuangan Setditjen Hubud",
  docType: "Nota Dinas",
  nature: "Biasa",
  classification: "KU.204 - Laporan Keuangan",
  autoNumber: true,
  number: "lama",
  subject: " Hal uji ",
  summary: "Ringkas",
  file: { uploadId: "u1", name: "konsep.pdf" },
  recipients: [{ id: "sr-a", label: "Enie Kurniawati - TU - Kementerian Perhubungan" }],
  verifiers: [{ id: "sr-v", label: "Enie Kurniawati" }],
  signer: { id: "sr-s", label: "Arif Priyo Utomo" },
};

describe("register SRIKANDI", () => {
  it("nama lampiran dibersihkan dari titik, koma, dan simbol", () => {
    expect(cleanAttachmentName("Lap. v1,2 (final).pdf")).toBe("Lap_ v1_2 _final_.pdf");
    expect(cleanAttachmentName("Tesis_Mohammad_Yusuf.pdf")).toBe("Tesis_Mohammad_Yusuf.pdf");
  });

  it("isian lengkap tanpa penghalang; Naskah Final tidak butuh verifikator/penandatangan", () => {
    expect(registerBlockers(entry)).toEqual([]);
    expect(registerBlockers({ ...entry, verifiers: [], signer: undefined })).toEqual(["Verifikator", "Penandatangan"]);
    expect(registerBlockers({ ...entry, formType: "final", verifiers: [], signer: undefined })).toEqual([]);
    expect(registerBlockers({ id: "x" })).toContain("File naskah");
  });

  it("jabatan referensi menjadi petunjuk; Ambil Nomor mengosongkan nomor ketikan", () => {
    const fields = buildRegisterFields(entry, [
      { id: "sr-s", label: "Arif Priyo Utomo", fields: { Jabatan: "Kepala Bagian Keuangan" } },
    ]);
    expect(fields.signer).toEqual({ label: "Arif Priyo Utomo", hint: "Kepala Bagian Keuangan" });
    expect(fields.verifiers).toEqual([{ label: "Enie Kurniawati" }]);
    expect(fields.number).toBeUndefined();
    expect(fields.subject).toBe("Hal uji");
    expect(buildRegisterFields({ ...entry, formType: "final" }, []).verifiers).toEqual([]);
  });
});

describe("register SRIKANDI — batas berkas", () => {
  const MB = 1024 * 1024;
  it("naskah & lampiran ≤ 5 MB, total lampiran ≤ 20 MB", () => {
    expect(registerSizeError(5 * MB, [5 * MB, 5 * MB, 5 * MB, 5 * MB])).toBeNull();
    expect(registerSizeError(5 * MB + 1, [])).toMatch(/naskah/);
    expect(registerSizeError(1, [5 * MB + 1])).toMatch(/lampiran lebih/);
    expect(registerSizeError(1, [5 * MB, 5 * MB, 5 * MB, 5 * MB, 1])).toMatch(/Total/);
  });
});

describe("pengenal perubahan entri Register", () => {
  it("sama untuk isi yang sama, berubah bila isian yang dikirim ke SRIKANDI berubah", () => {
    const base = outgoingSignature(entry);
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    expect(outgoingSignature({ ...entry, subject: `  ${entry.subject}  ` })).toBe(base);
    expect(outgoingSignature({ ...entry, status: "submitted" })).toBe(base);
    expect(outgoingSignature({ ...entry, summary: "Isi ringkas lain" })).not.toBe(base);
    expect(outgoingSignature({ ...entry, attachments: [{ uploadId: "x", name: "x.pdf" }] })).not.toBe(base);
    // Salinan frontend (register-logic.ts) harus menghasilkan nilai yang sama
    expect(outgoingSignature({ id: "a", subject: "Hal", autoNumber: true })).toBe("0af767ed");
  });
});

describe("sendBlockers", () => {
  it("hanya konsep terdaftar, belum dikirim, tanpa perubahan tertunda", () => {
    expect(sendBlockers({ ...entry, status: "ready" })[0]).toMatch(/belum terdaftar/);
    expect(sendBlockers({ ...entry, status: "submitted", draftSentAt: "2026-11-15" })[0]).toMatch(/sudah dikirim/);
    const pushed = { ...entry, status: "submitted", pushedSignature: outgoingSignature(entry) };
    expect(sendBlockers(pushed)).toEqual([]);
    expect(sendBlockers({ ...pushed, subject: "Hal lain" })[0]).toMatch(/Perbarui di SRIKANDI/);
    // Tandai terdaftar manual (tanpa pengenal) tetap boleh
    expect(sendBlockers({ ...entry, status: "submitted" })).toEqual([]);
  });
});
