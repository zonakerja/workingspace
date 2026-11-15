import { describe, expect, it } from "vitest";
import { inboxKey, inboxRequestedKinds, mergeInboxItems, parseInboxRows } from "./srikandi-inbox";

const masukHeaders = [
  "#",
  "NO",
  "TANGGAL NASKAH",
  "NOMOR NASKAH",
  "HAL",
  "ASAL NASKAH",
  "STATUS TINDAK LANJUT",
  "STATUS BACA",
  "AKSI",
];

describe("Naskah Masuk SRIKANDI", () => {
  it("baris Daftar Naskah Masuk → butir; baris filter & kosong dibuang", () => {
    const rows = [
      [
        "",
        "",
        "",
        "Cari Nomor Naskah",
        "Cari Hal",
        "Cari Asal Naskah",
        "Cari Status Tindak Lanjut",
        "Cari Status Baca",
        "",
      ],
      [
        "",
        "1",
        "Rabu, 11 November 2026",
        "UM.003/12/DJPU/2026",
        "Undangan Rapat Koordinasi BMN",
        "Direktur Bandar Udara",
        "BELUM DITINDAKLANJUTI",
        "BELUM DIBACA",
        "Lihat",
      ],
      ["Tidak ada data ditemukan"],
    ];
    const items = parseInboxRows("masuk", masukHeaders, rows);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "masuk",
      date: "2026-11-11",
      number: "UM.003/12/DJPU/2026",
      subject: "Undangan Rapat Koordinasi BMN",
      origin: "Direktur Bandar Udara",
      readStatus: "BELUM DIBACA",
      followUpStatus: "BELUM DITINDAKLANJUTI",
    });
    expect(items[0].fields).not.toHaveProperty("Aksi");
    expect(parseInboxRows("masuk", masukHeaders, [["Tidak ada data ditemukan"]])).toEqual([]);
  });

  it("baris disposisi tanpa kolom centang tetap selaras dari kanan", () => {
    const headers = [
      "#",
      "No",
      "Tanggal Disposisi",
      "Tanggal Naskah Masuk",
      "Uraian Informasi",
      "Instruksi",
      "Instruksi Tambahan",
      "Status Tindak Lanjut",
      "Status Baca",
      "Aksi",
    ];
    const [item] = parseInboxRows("disposisi", headers, [
      [
        "1",
        "Jumat, 13 November 2026",
        "Kamis, 12 November 2026",
        "Permohonan PSP BMN Bandara X",
        "Untuk ditindaklanjuti",
        "Siapkan konsep jawaban",
        "BELUM",
        "SUDAH DIBACA",
        "Lihat",
      ],
    ]);
    expect(item).toMatchObject({
      sentDate: "2026-11-13",
      date: "2026-11-12",
      info: "Permohonan PSP BMN Bandara X",
      instruction: "Untuk ditindaklanjuti",
      extraInstruction: "Siapkan konsep jawaban",
    });
  });

  it("kunci stabil & gabung halaman tanpa ganda; jenis yang diminta", () => {
    const a = parseInboxRows("masuk", masukHeaders, [
      ["", "1", "Rabu, 11 November 2026", "A/1", "Hal A", "X", "", "", ""],
    ]);
    expect(mergeInboxItems([a, a])).toHaveLength(1);
    expect(inboxKey(a[0])).toBe("masuk|a/1|2026-11-11||hal a|");
    expect(inboxRequestedKinds(["arahan", "x"])).toEqual(["arahan"]);
    expect(inboxRequestedKinds(undefined)).toHaveLength(5);
  });
});
