import {
  normalizeOption,
  parseRegisterForm,
  type RegisterFile,
  type RegisterForm,
  type RegisterPick,
} from "./srikandi-register.js";

/**
 * Logika murni **Edit** konsep di Log Naskah Keluar SRIKANDI (diuji di `srikandi-register-edit.test.ts`). Halaman
 * `/pembuatan-naskah-keluar/log-naskah-keluar/form?id=…&formode=Ubah` (direkam 2026-11-13) hanya ada untuk konsep yang
 * belum dikirim. Bagian atas (Dikirimkan melalui, Jenis, Sifat, Klasifikasi, Nomor, Hal, Isi Ringkas, Tipe TTD, Visual
 * TTE, File naskah) disimpan sekaligus lewat **Perbarui Naskah**; Lampiran, Tujuan (Utama/Tembusan), Daftar Verifikator,
 * dan Daftar Penandatangan adalah tabel terpisah dengan tombol Tambah (modal + Simpan) dan ikon hapus per baris
 * (konfirmasi "Data <nama> akan dihapus ?"). Tipe Form tidak bisa diubah. Kirim Konsep tidak pernah disentuh robot.
 */

export const EDIT_MARKER = "formode=Ubah";

/** Isi halaman Edit yang dibaca robot. */
export interface EditState {
  unit: string;
  docType: string;
  nature: string;
  classification: string;
  number: string;
  subject: string;
  summary: string;
  signatureType: "elektronik" | "konvensional" | "";
  visualTte: "qr" | "spesimen" | "";
  fileName: string;
  attachments: string[];
  /** Baris tabel Tujuan: kolom Kepada + Jenis (UTAMA / TEMBUSAN …) */
  recipients: { name: string; kind: string }[];
  verifiers: string[];
  signers: string[];
}

/** Masukan job Edit: formulir Akasha terkini (berkas naskah hanya bila diganti) + hal saat terakhir dikirim. */
export interface UpdateForm extends Omit<RegisterForm, "file"> {
  file?: RegisterFile;
  /** Hal konsep di SRIKANDI saat terakhir didaftarkan/diperbarui (dipakai mencari baris Log) */
  findSubject: string;
}

export type RecipientSlot = "utama" | "utama_eksternal" | "tembusan" | "tembusan_eksternal";

export interface EditPlan {
  /** Isian bagian atas yang berbeda (label) — disimpan dengan Perbarui Naskah */
  top: string[];
  replaceFile: boolean;
  attachmentsAdd: RegisterFile[];
  attachmentsRemove: string[];
  recipientsAdd: { slot: RecipientSlot; pick: RegisterPick }[];
  recipientsRemove: string[];
  verifiersAdd: RegisterPick[];
  verifiersRemove: string[];
  signerAdd: RegisterPick | null;
  signersRemove: string[];
  warnings: string[];
}

const head = (text: string) =>
  normalizeOption(text)
    .split(" - ")[0]
    .replace(/[.\s]+$/, "")
    .trim();

/** Baris tabel (nama atau "Nama - Jabatan") mewakili pilihan Akasha bila nama/kodenya sama. */
export const sameParty = (row: string, pick: RegisterPick) => head(row) === head(pick.label);

/** Isian react-select sama: persis, atau kode/nama bagian pertama sama ("KU.204 - Laporan Keuangan"). */
const sameChoice = (current: string, wanted: string) =>
  normalizeOption(current) === normalizeOption(wanted) || (!!current && head(current) === head(wanted));

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Nama berkas untuk dibandingkan: huruf kecil tanpa ekstensi, hanya huruf & angka. */
export const fileKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, "")
    .replace(/[^a-z0-9]+/g, "");

const sameFile = (row: string, name: string) => {
  const a = fileKey(row);
  const b = fileKey(name);
  return !!a && !!b && (a === b || a.endsWith(b) || a.includes(b));
};

const isTembusan = (kind: string) => /tembusan/i.test(kind);

/**
 * Rencana perubahan: hanya yang berbeda yang diubah. Tambah dulu, hapus kemudian (daftar verifikator/penandatangan tidak
 * pernah kosong di tengah proses). Grup Tujuan/Tembusan tidak bisa dicocokkan dengan baris (SRIKANDI memecahnya menjadi
 * anggota), jadi bila entri memakai grup, baris tujuan jenis itu tidak dihapus dan grupnya tidak ditambahkan (peringatan).
 */
export function planEdit(form: UpdateForm, state: EditState): EditPlan {
  const warnings: string[] = [];
  const top: string[] = [];
  if (!sameChoice(state.unit, form.unit)) top.push("Dikirimkan melalui");
  if (!sameChoice(state.docType, form.docType)) top.push("Jenis Naskah");
  if (!sameChoice(state.nature, form.nature)) top.push("Sifat Naskah");
  if (!sameChoice(state.classification, form.classification)) top.push("Klasifikasi");
  if (form.autoNumber ? !state.number.trim() : !sameText(state.number, form.number ?? "")) top.push("Nomor Naskah");
  if (!sameText(state.subject, form.subject)) top.push("Hal");
  if (!sameText(state.summary, form.summary)) top.push("Isi Ringkas");
  if (form.formType === "keluar") {
    if (state.signatureType && state.signatureType !== form.signatureType) top.push("Tipe Tanda Tangan");
    if (form.signatureType === "elektronik" && state.visualTte && state.visualTte !== form.visualTte)
      top.push("Visual TTE");
  }
  const replaceFile = !!form.file;
  if (replaceFile) top.push("File naskah");

  const attachmentsAdd = form.attachments.filter((a) => !state.attachments.some((row) => sameFile(row, a.name)));
  const attachmentsRemove = state.attachments.filter((row) => !form.attachments.some((a) => sameFile(row, a.name)));

  const wanted: { slot: RecipientSlot; pick: RegisterPick }[] = [
    ...form.recipients.map((pick) => ({ slot: "utama" as const, pick })),
    ...form.recipientsExternal.map((pick) => ({ slot: "utama_eksternal" as const, pick })),
    ...form.cc.map((pick) => ({ slot: "tembusan" as const, pick })),
    ...form.ccExternal.map((pick) => ({ slot: "tembusan_eksternal" as const, pick })),
  ];
  const slotIsCc = (slot: RecipientSlot) => slot.startsWith("tembusan");
  const recipientsAdd = wanted.filter(
    (w) => !state.recipients.some((r) => isTembusan(r.kind) === slotIsCc(w.slot) && sameParty(r.name, w.pick)),
  );
  const keepUtama = form.recipientGroups.length > 0;
  const keepCc = form.ccGroups.length > 0;
  if (keepUtama) warnings.push("Grup Tujuan tidak diubah lewat Edit (SRIKANDI memecahnya menjadi anggota).");
  if (keepCc) warnings.push("Grup Tembusan tidak diubah lewat Edit (SRIKANDI memecahnya menjadi anggota).");
  const recipientsRemove = state.recipients
    .filter((r) => (isTembusan(r.kind) ? !keepCc : !keepUtama))
    .filter((r) => !wanted.some((w) => isTembusan(r.kind) === slotIsCc(w.slot) && sameParty(r.name, w.pick)))
    .map((r) => r.name);

  const verifiersAdd =
    form.formType === "keluar" ? form.verifiers.filter((v) => !state.verifiers.some((row) => sameParty(row, v))) : [];
  const verifiersRemove =
    form.formType === "keluar" ? state.verifiers.filter((row) => !form.verifiers.some((v) => sameParty(row, v))) : [];
  const signerAdd =
    form.formType === "keluar" && form.signer && !state.signers.some((row) => sameParty(row, form.signer!))
      ? form.signer
      : null;
  const signersRemove =
    form.formType === "keluar" && form.signer ? state.signers.filter((row) => !sameParty(row, form.signer!)) : [];
  if (form.formType === "keluar" && verifiersAdd.length === 0 && verifiersRemove.length === 0) {
    const order = state.verifiers.map((row) => form.verifiers.findIndex((v) => sameParty(row, v)));
    if (order.some((i, n) => n > 0 && i < order[n - 1]))
      warnings.push("Urutan verifikator di SRIKANDI berbeda; urutan tidak diubah robot.");
  }

  return {
    top,
    replaceFile,
    attachmentsAdd,
    attachmentsRemove,
    recipientsAdd,
    recipientsRemove,
    verifiersAdd,
    verifiersRemove,
    signerAdd,
    signersRemove,
    warnings,
  };
}

export const planIsEmpty = (plan: EditPlan) =>
  !plan.top.length &&
  !plan.attachmentsAdd.length &&
  !plan.attachmentsRemove.length &&
  !plan.recipientsAdd.length &&
  !plan.recipientsRemove.length &&
  !plan.verifiersAdd.length &&
  !plan.verifiersRemove.length &&
  !plan.signerAdd &&
  !plan.signersRemove.length;

const SLOT_LABEL: Record<RecipientSlot, string> = {
  utama: "Tujuan utama",
  utama_eksternal: "Tujuan utama eksternal non SRIKANDI",
  tembusan: "Tembusan",
  tembusan_eksternal: "Tembusan eksternal non SRIKANDI",
};

/** Langkah rencana dalam kalimat, untuk ditinjau pemilik (Periksa) dan dicatat di riwayat. */
export function describePlan(plan: EditPlan): string[] {
  const names = (picks: RegisterPick[]) => picks.map((p) => p.label.split(" - ")[0]).join(", ");
  return [
    plan.top.length && `Perbarui Naskah: ${plan.top.join(", ")}`,
    plan.attachmentsAdd.length && `Tambah lampiran: ${plan.attachmentsAdd.map((a) => a.name).join(", ")}`,
    plan.attachmentsRemove.length && `Hapus lampiran: ${plan.attachmentsRemove.join(", ")}`,
    ...plan.recipientsAdd.map((r) => `Tambah ${SLOT_LABEL[r.slot]}: ${r.pick.label.split(" - ")[0]}`),
    plan.recipientsRemove.length &&
      `Hapus tujuan/tembusan: ${plan.recipientsRemove.map((n) => n.split(" - ")[0]).join(", ")}`,
    plan.verifiersAdd.length && `Tambah verifikator: ${names(plan.verifiersAdd)}`,
    plan.verifiersRemove.length &&
      `Hapus verifikator: ${plan.verifiersRemove.map((n) => n.split(" - ")[0]).join(", ")}`,
    plan.signerAdd && `Ganti penandatangan: ${plan.signerAdd.label.split(" - ")[0]}`,
    plan.signersRemove.length && `Hapus penandatangan: ${plan.signersRemove.map((n) => n.split(" - ")[0]).join(", ")}`,
  ].filter((s): s is string => !!s);
}

/**
 * Konfirmasi hapus yang boleh diklik robot: hanya baris di dalam halaman Edit ("Data <nama> akan dihapus ?"). Hapus
 * konsep dari Log ("Log Naskah … akan dihapus?") dan konfirmasi lain selalu ditolak.
 */
export function isRowRemovalConfirm(url: string, message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  return (
    url.includes("/log-naskah-keluar/form") &&
    url.includes(EDIT_MARKER) &&
    /^Data .+ akan dihapus\s*\?/i.test(text) &&
    !/log naskah/i.test(text)
  );
}

/** Item menu "Tambah" tabel Tujuan untuk satu jenis: induk (Tujuan Utama / Tembusan) lalu anak. */
export function recipientMenu(slot: RecipientSlot) {
  return {
    parent: slot.startsWith("tembusan") ? "Tembusan" : "Tujuan Utama",
    child: slot.endsWith("eksternal") ? "Eksternal Non Srikandi" : "Internal/Eksternal Srikandi",
  };
}

/**
 * Validasi masukan job Edit: aturan sama dengan pendaftaran (`parseRegisterForm`), tetapi berkas naskah opsional (hanya
 * dikirim bila diganti) dan hal lama wajib untuk mencari konsep di Log.
 */
export function parseUpdateForm(body: unknown): { form: UpdateForm } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const findSubject = typeof b.findSubject === "string" ? b.findSubject.trim().slice(0, 1_000) : "";
  if (!findSubject) return { error: "Hal konsep di SRIKANDI wajib." };
  const hasFile = !!b.file;
  // Berkas pengganti sementara agar aturan isian lain tetap diperiksa oleh parseRegisterForm yang sama
  const parsed = parseRegisterForm(hasFile ? b : { ...b, file: { name: "tanpa-ganti.pdf", data: "AA==" } });
  if ("error" in parsed) return parsed;
  const { file, ...rest } = parsed.form;
  return { form: { ...rest, ...(hasFile ? { file } : {}), findSubject } };
}

/**
 * Baris Log konsep yang akan diubah: hal saat terakhir dikirim, lalu hal terbaru (Perbarui yang terhenti di tengah jalan
 * sudah menyimpan hal baru tetapi Akasha belum mencatatnya). Baris yang masih punya tautan Edit diutamakan.
 */
export function findEditRow<T extends { subject: string; editHref?: string | null }>(
  rows: T[],
  findSubject: string,
  subject: string,
) {
  for (const wanted of [findSubject, subject]) {
    const want = normalizeOption(wanted);
    const same = rows.filter((r) => normalizeOption(r.subject) === want);
    const row = same.find((r) => r.editHref) ?? same[0];
    if (row) return row;
  }
  return null;
}
