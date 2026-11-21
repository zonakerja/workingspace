import { describe, expect, it } from "vitest";
import { parseTteResult } from "./tte-verify.js";

// Teks hasil sungguhan halaman verifikasi Komdigi (Permohonan PSP Letung, 2026-11-21)
const SUMMARY = `Dokumen ini memiliki Tanda Tangan Digital
Dokumen belum dimodifikasi
1 tanda tangan ditemukan
Ringkasan Dokumen
INFORMASI TANDA TANGAN
1
Tanda tangan dengan identitas terverifikasi
INFORMASI PSrE
Badan Siber dan Sandi Negara
1
INFORMASI DOKUMEN
Informasi Penandatangan
PENANDATANGAN
DENNY ARMANTO
Tanda Tangan
05 November 2026, 16:07:23
Kementerian Perhubungan
Badan Siber dan Sandi Negara
Lihat Detil`;

const DETAIL = `${SUMMARY}
RINGKASAN VERIFIKASI
Keaslian Dokumen
Dokumen belum dimodifikasi
Asli
Identitas Penandatangan
Dokumen dengan identitas penandatangan terpercaya
Terverifikasi
Waktu Tanda Tangan
Tanda tangan memiliki penanda waktu elektronik dari TSA berinduk
Valid
Validasi Jangka Panjang (LTV)
Tanda tangan tidak mendukung LTV
Tidak Mendukung
INFORMASI PENANDATANGAN
Penandatangan
DENNY ARMANTO
Alasan
Dokumen ini telah ditandatangani secara elektronik menggunakan sertifikat elektronik yang diterbitkan oleh BSrE.
Lokasi
Indonesia
Waktu Penandatanganan
05 November 2026, 16:07:23
STATUS SERTIFIKAT PENANDATANGAN
Sertifikat ini terpercaya
Sertifikat ini belum melewati tanggal kedaluwarsa
Sertifikat ini tidak dicabut
RANTAI SERTIFIKAT PENANDATANGAN
ROOT CA
Root CA Indonesia DS G1
Tepercaya
Lihat Sertifikat
INTERMEDIATE CA
BSRE CA DS G1
Tepercaya
Lihat Sertifikat
PENANDA TANGAN
DENNY ARMANTO
Tepercaya
Lihat Sertifikat
STEMPEL WAKTU (TSA)
ROOT CA
Verifikasi Dokumen Lain`;

describe("tte-verify", () => {
  it("valid signed PDF", () => {
    const r = parseTteResult(SUMMARY, [DETAIL]);
    expect(r.verdict).toBe("valid");
    expect(r.modified).toBe(false);
    expect(r.signatureCount).toBe(1);
    expect(r.signers).toEqual([{ name: "DENNY ARMANTO", signedAt: "05 November 2026, 16:07:23" }]);
    expect(r.psre).toEqual(["Badan Siber dan Sandi Negara"]);
    expect(r.details[0]).toMatchObject({
      signer: "DENNY ARMANTO",
      authenticity: "Asli",
      identity: "Terverifikasi",
      timestamp: "Valid",
      certificateTrusted: true,
      certificateNotExpired: true,
      certificateNotRevoked: true,
    });
    expect(r.details[0].chain).toHaveLength(3);
    expect(r.issues).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/LTV/);
  });

  it("PDF without digital signature", () => {
    const r = parseTteResult(
      "Perhatian diperlukan\nDokumen PDF ini tidak memiliki tanda tangan digital yang dapat diverifikasi.\nVerifikasi Dokumen Lain",
    );
    expect(r.verdict).toBe("tanpa_tte");
    expect(r.hasSignature).toBe(false);
  });

  it("flags modified documents and untrusted certificates", () => {
    const bad = DETAIL.replace(/belum dimodifikasi/g, "telah dimodifikasi")
      .replace("\nAsli\n", "\nTidak Asli\n")
      .replace("Sertifikat ini terpercaya", "Sertifikat ini tidak terpercaya")
      .replace("Sertifikat ini tidak dicabut", "Sertifikat ini dicabut");
    const r = parseTteResult(bad.split("RINGKASAN VERIFIKASI")[0], [bad]);
    expect(r.verdict).toBe("bermasalah");
    expect(r.modified).toBe(true);
    expect(r.issues.join(" ")).toMatch(/dimodifikasi/);
    expect(r.issues.join(" ")).toMatch(/tidak terpercaya/);
    expect(r.issues.join(" ")).toMatch(/dicabut/);
  });
});
