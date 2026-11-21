/**
 * Verifikasi tanda tangan elektronik (TTE) PDF lewat halaman resmi Komdigi https://tte.komdigi.go.id/verifyPDF (memuat
 * verifikator cekdokumen.id dalam bingkai, tanpa login). Robot memakai halaman seperti pengguna: unggah PDF, baca ringkasan,
 * buka "Lihat Detil" tiap tanda tangan. API resmi cekdokumen butuh API key — tidak dipakai/diakali. Logika murni pembaca
 * teks hasil → `tte-verify.test.ts`.
 */

export const TTE_VERIFY_URL = "https://tte.komdigi.go.id/verifyPDF";
/** Host yang boleh dibuka job ini (halaman Komdigi + bingkai verifikator). */
export const TTE_HOSTS = ["tte.komdigi.go.id", "cekdokumen.id", "verifikasipdf.rootca.id"];
export const TTE_MAX_BYTES = 20 * 1024 * 1024;

export interface TteSignatureDetail {
  signer: string | null;
  authenticity: string | null;
  identity: string | null;
  timestamp: string | null;
  ltv: string | null;
  reason: string | null;
  signedAt: string | null;
  certificateTrusted: boolean | null;
  certificateNotExpired: boolean | null;
  certificateNotRevoked: boolean | null;
  chain: string[];
}

export interface TteVerifyResult {
  verdict: "valid" | "bermasalah" | "tanpa_tte" | "tidak_terbaca";
  hasSignature: boolean | null;
  modified: boolean | null;
  signatureCount: number | null;
  signers: { name: string; signedAt: string | null }[];
  psre: string[];
  details: TteSignatureDetail[];
  issues: string[];
  notes: string[];
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** Nilai = baris setelah label (mis. "Penandatangan" → "DENNY ARMANTO"). */
function after(list: string[], label: RegExp, offset = 1): string | null {
  const i = list.findIndex((l) => label.test(l));
  return i >= 0 && list[i + offset] ? list[i + offset] : null;
}

/** Status satu bagian Ringkasan Verifikasi: label, keterangan, lalu nilai ("Asli", "Terverifikasi", "Valid", …). */
function status(list: string[], label: RegExp): string | null {
  const i = list.findIndex((l) => label.test(l));
  if (i < 0) return null;
  return list[i + 2] ?? null;
}

/** Baca satu panel "Lihat Detil" (teks panel setelah judul RINGKASAN VERIFIKASI). */
export function parseTteDetail(text: string): TteSignatureDetail {
  const all = lines(text);
  const start = all.findIndex((l) => /^RINGKASAN VERIFIKASI$/i.test(l));
  const list = start >= 0 ? all.slice(start) : all;
  const has = (re: RegExp) => list.some((l) => re.test(l));
  const chainStart = list.findIndex((l) => /^RANTAI SERTIFIKAT/i.test(l));
  const chain: string[] = [];
  if (chainStart >= 0) {
    for (let i = chainStart + 1; i < list.length; i++) {
      if (/^(STEMPEL WAKTU \(TSA\)|Verifikasi Dokumen Lain)$/i.test(list[i])) break;
      if (/^(ROOT CA|INTERMEDIATE CA|PENANDA TANGAN)$/i.test(list[i]) && list[i + 1])
        chain.push(
          `${list[i]}: ${list[i + 1]}${list[i + 2] && !/^Lihat/i.test(list[i + 2]) ? ` (${list[i + 2]})` : ""}`,
        );
    }
  }
  return {
    signer: after(list, /^Penandatangan$/i),
    authenticity: status(list, /^Keaslian Dokumen$/i),
    identity: status(list, /^Identitas Penandatangan$/i),
    timestamp: status(list, /^Waktu Tanda Tangan$/i),
    ltv: status(list, /^Validasi Jangka Panjang/i),
    reason: after(list, /^Alasan$/i),
    signedAt: after(list, /^Waktu Penandatanganan$/i),
    certificateTrusted: has(/^Sertifikat ini terpercaya$/i)
      ? true
      : has(/^Sertifikat ini tidak terpercaya$/i)
        ? false
        : null,
    certificateNotExpired: has(/belum melewati tanggal kedaluwarsa/i)
      ? true
      : has(/(sudah|telah) (melewati tanggal )?kedaluwarsa/i)
        ? false
        : null,
    certificateNotRevoked: has(/^Sertifikat ini tidak dicabut$/i)
      ? true
      : has(/^Sertifikat ini (telah )?dicabut$/i)
        ? false
        : null,
    chain,
  };
}

/**
 * Hasil keseluruhan dari teks ringkasan + panel detail per tanda tangan. "valid" hanya bila dokumen tidak dimodifikasi,
 * setiap tanda tangan identitasnya terverifikasi, stempel waktu valid, dan sertifikat terpercaya/berlaku/tidak dicabut.
 * LTV tidak didukung = catatan, bukan masalah.
 */
export function parseTteResult(summary: string, detailTexts: string[] = []): TteVerifyResult {
  const list = lines(summary);
  const text = list.join("\n");
  const noSignature = /tidak (memiliki|ditemukan) tanda tangan|tanpa tanda tangan digital|tidak ada tanda tangan/i.test(
    text,
  );
  const hasSignature = noSignature ? false : /memiliki Tanda Tangan Digital/i.test(text) ? true : null;
  const modified = /belum dimodifikasi/i.test(text)
    ? false
    : /(sudah|telah) dimodifikasi|dimodifikasi setelah/i.test(text)
      ? true
      : null;
  const countMatch = text.match(/(\d+) tanda tangan ditemukan/i);
  const signers: { name: string; signedAt: string | null }[] = [];
  list.forEach((l, i) => {
    if (/^PENANDATANGAN$/.test(l) && list[i + 1]) {
      const at = list[i + 2] === "Tanda Tangan" ? (list[i + 3] ?? null) : null;
      signers.push({ name: list[i + 1], signedAt: at });
    }
  });
  const psreIndex = list.findIndex((l) => /^INFORMASI PSrE$/i.test(l));
  const psre = psreIndex >= 0 && list[psreIndex + 1] && !/^\d+$/.test(list[psreIndex + 1]) ? [list[psreIndex + 1]] : [];
  const details = detailTexts.map(parseTteDetail);

  const issues: string[] = [];
  const notes: string[] = [];
  if (modified === true) issues.push("Dokumen telah dimodifikasi setelah ditandatangani.");
  details.forEach((d, i) => {
    const who = d.signer ?? `tanda tangan ${i + 1}`;
    if (d.authenticity && !/^asli$/i.test(d.authenticity)) issues.push(`${who}: keaslian dokumen "${d.authenticity}".`);
    if (d.identity && !/terverifikasi/i.test(d.identity))
      issues.push(`${who}: identitas penandatangan "${d.identity}".`);
    if (d.timestamp && !/^valid$/i.test(d.timestamp)) issues.push(`${who}: stempel waktu "${d.timestamp}".`);
    if (d.certificateTrusted === false) issues.push(`${who}: sertifikat tidak terpercaya.`);
    if (d.certificateNotExpired === false) issues.push(`${who}: sertifikat kedaluwarsa.`);
    if (d.certificateNotRevoked === false) issues.push(`${who}: sertifikat dicabut.`);
    if (d.ltv && /tidak/i.test(d.ltv))
      notes.push(`${who}: tidak mendukung validasi jangka panjang (LTV) — bukan masalah keabsahan saat ini.`);
  });
  const count = countMatch ? Number(countMatch[1]) : null;
  if (hasSignature && count !== null && details.length < count)
    notes.push(`Detail ${details.length} dari ${count} tanda tangan terbaca.`);

  const verdict: TteVerifyResult["verdict"] =
    hasSignature === false
      ? "tanpa_tte"
      : hasSignature !== true
        ? "tidak_terbaca"
        : issues.length || !details.length
          ? issues.length
            ? "bermasalah"
            : "tidak_terbaca"
          : "valid";
  return { verdict, hasSignature, modified, signatureCount: count, signers, psre, details, issues, notes };
}
