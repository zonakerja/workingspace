import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Document, ImageRun, Packer, Paragraph } from "docx";
import mammoth from "mammoth";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import {
  analysisDocument,
  decreeDocument,
  normalizeDocumentData,
  packDocument,
  type SimanDocumentAsset,
  terbilang,
  textChanges,
  withLetterhead,
} from "./siman-documents";

const garuda = readFileSync(join(__dirname, "..", "..", "templates", "siman", "garuda.png"));

const data = normalizeDocumentData({
  ticket: "ppl26110408030558728",
  kodeSatker: "022053200649046000KD",
  satker: "Kantor Unit Penyelenggara Bandar Udara Kelas III Letung",
  pejabatPemohon: "Kepala Kantor UPBU Kelas III Letung",
  nomorSurat: "PL.202/14/XI/UPBU-LTG/2026",
  tanggalSurat: "4 November 2026",
  perihal: "Permohonan Penetapan Status Penggunaan Barang Milik Negara",
  kanwil: "Kepala Kanwil DJKN Riau, Sumatera Barat, dan Kepulauan Riau",
  kpknl: "Kepala KPKNL Tanjungpinang",
  status: "lengkap",
  kelengkapan: [{ no: "1.", dok: "Asli Surat Permohonan", cek: "Ada" }],
});

const assets: SimanDocumentAsset[] = [
  {
    kodeRegister: "5F5BA4288EB67CFCE06365E7D80A0330",
    kodeBarang: "3050104002",
    namaBarang: "Lemari Kayu",
    nup: "1",
    merk: "Lemari Pakaian Kayu",
    tipe: "-",
    tanggalPerolehan: "11-08-2026",
    nilaiPerolehan: 1720500,
    kondisi: "Baik",
  },
];

const text = async (buffer: Buffer) => (await mammoth.extractRawText({ buffer })).value;

describe("siman-documents", () => {
  it("memeriksa data dari agen", () => {
    expect(data).toMatchObject({ ticket: "PPL26110408030558728", status: "LENGKAP" });
    expect(normalizeDocumentData({ satker: "x" })).toHaveProperty("error");
    expect(terbilang(1720500)).toBe("satu juta tujuh ratus dua puluh ribu lima ratus");
  });

  it("konsep KM PSP berisi diktum, nilai, lampiran, dan penanda SRIKANDI", async () => {
    if ("error" in data) throw new Error(data.error);
    const out = await text(await packDocument(decreeDocument(data, assets, garuda)));
    expect(out).toContain("sejumlah 1 (satu) unit");
    expect(out).toContain("Rp1.720.500,00 (satu juta tujuh ratus dua puluh ribu lima ratus rupiah)");
    expect(out).toContain("${nomor_naskah}");
    expect(out).toContain("5F5BA4288EB67CFCE06365E7D80A0330");
    expect(out).toContain("Kepala KPKNL Tanjungpinang.");
  });

  it("Dokumen Analisis memakai kop templat", async () => {
    if ("error" in data) throw new Error(data.error);
    const template = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [new ImageRun({ data: garuda, type: "png", transformation: { width: 50, height: 50 } })],
              }),
              new Paragraph("jarak"),
              new Paragraph("jarak"),
              new Paragraph("isi surat lama"),
            ],
          },
        ],
      }),
    );
    const merged = withLetterhead(await packDocument(analysisDocument(data, assets)), template);
    const xml = new PizZip(merged).file("word/document.xml")!.asText();
    expect(xml).toContain("<w:drawing>");
    const out = await text(merged);
    expect(out).toContain("CHECKLIST KELENGKAPAN DOKUMEN");
    expect(out).not.toContain("isi surat lama");
    expect(() => withLetterhead(merged, Buffer.from(template))).not.toThrow();
  });

  it("perubahan teks dari suntingan pemilik", () => {
    const c = textChanges("A\nB\nC", "A\nB diubah\nC\nD");
    expect(c).toMatchObject({ changed: true, removed: ["B"], added: ["B diubah", "D"] });
    expect(textChanges("A\n\nB", "A\nB").changed).toBe(false);
  });
});
