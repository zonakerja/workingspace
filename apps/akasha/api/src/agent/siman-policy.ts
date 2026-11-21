/**
 * Logika murni Kebijakan Otomatis sumber **Workflow SIMAN** (diuji `siman-policy.spec.ts`). Yang memutuskan = kode ini atas
 * fakta yang dihitung server dari hasil baca tiket SIMAN (bukan pernyataan model):
 *  - Kelengkapan SIMAN memuat Surat Permohonan dan SPTJM, dan berkasnya berhasil diambil;
 *  - aset bukan tanah/bangunan (tanah/bangunan butuh dokumen kepemilikan → selalu diserahkan ke pemilik);
 *  - jumlah/nilai daftar aset usulan cocok dengan kepala tiket;
 *  - status kelengkapan analisis AI agent = LENGKAP dan Dokumen Analisis + konsep KM PSP sudah dibuat.
 * Listing BMN tidak wajib: daftar aset usulan SIMAN sudah memastikan aset tercatat (arahan pemilik 2026-11-20).
 */

export interface SimanKelengkapanRow {
  jenis: string;
  nama?: string;
  uploadId: string | null;
}

export interface SimanFacts {
  ticket: string;
  /** Surat Permohonan ada di Kelengkapan SIMAN dan berkasnya terambil */
  suratPermohonan: boolean;
  /** SPTJM ada di Kelengkapan SIMAN dan berkasnya terambil */
  sptjm: boolean;
  /** Jenis aset tanah dan/atau bangunan (butuh dokumen kepemilikan) */
  landOrBuilding: boolean;
  /** Jumlah/nilai daftar aset cocok dengan Nilai Permohonan kepala tiket (null = tidak bisa dibandingkan) */
  assetsMatch: boolean | null;
  assetCount: number;
  /** Status kelengkapan menurut Dokumen Analisis (AI agent) */
  analysisStatus: "LENGKAP" | "TIDAK LENGKAP";
  documents: { analysis: boolean; decree: boolean };
  /** Tiket tampil di daftar Penetapan akun SIMAN pemilik (didisposisikan ke pemilik) */
  disposed: boolean;
  /** Status tiket di daftar Penetapan, mis. "7.4.3 - Proses Penelitian Analis Eselon 1" (null = tidak diketahui) */
  stage: string | null;
}

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, " ");
const SPTJM = /sptjm|pernyataan tanggung jawab mutlak/;
const SURAT = /surat permohonan|permohonan (penetapan|psp)/;

/** Fakta kelengkapan dari baris Kelengkapan Dokumen SIMAN (jenis dokumen + berkas yang terunduh). */
export function kelengkapanFacts(rows: SimanKelengkapanRow[]) {
  const has = (pattern: RegExp) => rows.some((r) => pattern.test(fold(`${r.jenis} ${r.nama ?? ""}`)) && !!r.uploadId);
  return { suratPermohonan: has(SURAT), sptjm: has(SPTJM) };
}

/** Jenis aset tanah/bangunan dari Informasi Umum tiket (Jenis Aset / Tipe Pengelolaan). */
export function isLandOrBuilding(jenisAset: string, tipe: string): boolean {
  const text = fold(`${jenisAset} ${tipe}`);
  if (/selain tanah/.test(text)) return false;
  return /tanah|bangunan/.test(text);
}

export interface SimanDecisionInput {
  facts: SimanFacts;
  mode: string;
  requestStatus: string;
  paused: boolean;
  usedToday: number;
  dailyLimit: number;
}

const OPEN = ["baru", "diproses", "menunggu_verifikasi"];

/** Keputusan aturan; alasan selalu diisi agar terlihat di riwayat pengajuan. */
export function decideSimanPolicy(input: SimanDecisionInput): {
  outcome: "approve" | "review";
  apply: boolean;
  reasons: string[];
} {
  const f = input.facts;
  const reasons: string[] = [];
  if (!OPEN.includes(input.requestStatus)) reasons.push("Pengajuan sudah diputuskan.");
  if (!f.disposed) reasons.push("Tiket tidak didisposisikan ke pemilik (tidak ada di daftar Penetapan akun SIMAN).");
  else if (!f.stage || !/penelitian/i.test(f.stage))
    reasons.push(`Tiket tidak pada tahap penelitian (status: ${f.stage || "tidak diketahui"}).`);
  if (f.landOrBuilding) reasons.push("Aset tanah/bangunan butuh pemeriksaan dokumen kepemilikan oleh pemilik.");
  if (!f.suratPermohonan) reasons.push("Surat Permohonan tidak ada / tidak terambil dari Kelengkapan SIMAN.");
  if (!f.sptjm) reasons.push("SPTJM tidak ada / tidak terambil dari Kelengkapan SIMAN.");
  if (f.assetCount === 0) reasons.push("Daftar aset usulan kosong.");
  else if (f.assetsMatch === false) reasons.push("Jumlah nilai daftar aset tidak sama dengan Nilai Permohonan tiket.");
  else if (f.assetsMatch === null) reasons.push("Nilai Permohonan tiket tidak terbaca untuk dicocokkan.");
  if (f.analysisStatus !== "LENGKAP") reasons.push("Dokumen Analisis menyatakan TIDAK LENGKAP.");
  if (!f.documents.analysis || !f.documents.decree) reasons.push("Dokumen Analisis atau konsep KM PSP belum dibuat.");
  if (reasons.length) return { outcome: "review", apply: false, reasons };

  const ok = [
    `Kelengkapan SIMAN: Surat Permohonan & SPTJM ada; ${f.assetCount} aset cocok dengan Nilai Permohonan; analisis LENGKAP.`,
  ];
  if (input.mode !== "auto")
    return { outcome: "approve", apply: false, reasons: [...ok, "Mode shadow: hanya dicatat."] };
  if (input.paused) return { outcome: "approve", apply: false, reasons: [...ok, "Sakelar darurat aktif."] };
  if (input.usedToday >= input.dailyLimit) {
    return {
      outcome: "approve",
      apply: false,
      reasons: [...ok, `Batas ${input.dailyLimit} keputusan otomatis per 24 jam tercapai.`],
    };
  }
  return { outcome: "approve", apply: true, reasons: ok };
}
