import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import PizZip from "pizzip";

/**
 * Pembuat dokumen hasil workflow Penetapan SIMAN (PSP BMN selain tanah dan/atau bangunan): **Dokumen Analisis** (A4, kop
 * Ditjen Perhubungan Udara dari templat Surat Dinas pemilik) dan **konsep KM PSP** (F4 + lampiran daftar BMN F4 mendatar).
 * Format = yang disetujui pemilik 2026-11-19 (docs/AI-AGENT.md §26.5b–c). Penanda SRIKANDI (`${nomor_naskah}`,
 * `${tanggal_naskah}`, `${ttd_pengirim}`, `${nama_pengirim}`, `${nip_pengirim}`) dibiarkan utuh — diisi SRIKANDI.
 * Logika murni (tanpa I/O) — diuji `siman-documents.spec.ts`.
 */

export interface SimanChecklistItem {
  no: string;
  dok: string;
  cek: string;
}

export interface SimanDocumentData {
  ticket: string;
  kodeSatker: string;
  /** Nama satker lengkap (mis. "Kantor Unit Penyelenggara Bandar Udara Kelas III Letung") */
  satker: string;
  /** Jabatan penanda tangan surat permohonan */
  pejabatPemohon: string;
  nomorSurat: string;
  /** Tanggal pada isi surat, mis. "4 November 2026" */
  tanggalSurat: string;
  perihal: string;
  /** Tembusan Kanwil DJKN, mis. "Kepala Kanwil DJKN Riau, Sumatera Barat, dan Kepulauan Riau" */
  kanwil: string;
  /** Tembusan KPKNL, mis. "Kepala KPKNL Tanjungpinang" */
  kpknl: string;
  status: "LENGKAP" | "TIDAK LENGKAP";
  kelengkapan: SimanChecklistItem[];
}

export interface SimanDocumentAsset {
  kodeRegister: string;
  kodeBarang: string;
  namaBarang: string;
  nup: string;
  merk: string;
  tipe: string;
  tanggalPerolehan: string;
  nilaiPerolehan: number;
  kondisi: string;
}

const FONT = "Arial";
const F4 = { width: 12240, height: 18720 };
const SK_MARGIN = { top: 1134, right: 1134, bottom: 851, left: 1701 };
const SK_TEXT_W = F4.width - SK_MARGIN.left - SK_MARGIN.right;
/** A4 + margin templat Surat Dinas Ditjen Hubud */
const A4 = { width: 11906, height: 16838 };
const ANALYSIS_MARGIN = { top: 1418, right: 1304, bottom: 851, left: 1304 };

export const rupiahText = (n: number) => Math.round(n).toLocaleString("id-ID");

/** Terbilang bahasa Indonesia (huruf kecil), mis. 99467100 → "sembilan puluh sembilan juta …". */
export function terbilang(value: number): string {
  const s = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  const n = Math.floor(value);
  if (n < 12) return s[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh ${terbilang(n % 10)}`.trim();
  if (n < 200) return `seratus ${terbilang(n - 100)}`.trim();
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus ${terbilang(n % 100)}`.trim();
  if (n < 2000) return `seribu ${terbilang(n - 1000)}`.trim();
  if (n < 1e6) return `${terbilang(Math.floor(n / 1000))} ribu ${terbilang(n % 1000)}`.trim();
  if (n < 1e9) return `${terbilang(Math.floor(n / 1e6))} juta ${terbilang(n % 1e6)}`.trim();
  if (n < 1e12) return `${terbilang(Math.floor(n / 1e9))} miliar ${terbilang(n % 1e9)}`.trim();
  return `${terbilang(Math.floor(n / 1e12))} triliun ${terbilang(n % 1e12)}`.trim();
}

/** Periksa & rapikan data dari agen. Mengembalikan pesan galat berbahasa Indonesia agar agen bisa memperbaikinya. */
export function normalizeDocumentData(raw: unknown): SimanDocumentData | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string, max = 500) =>
    typeof r[key] === "string" ? (r[key] as string).replace(/\s+/g, " ").trim().slice(0, max) : "";
  const data: SimanDocumentData = {
    ticket: text("ticket", 30).toUpperCase(),
    kodeSatker: text("kodeSatker", 40),
    satker: text("satker", 200),
    pejabatPemohon: text("pejabatPemohon", 300),
    nomorSurat: text("nomorSurat", 120),
    tanggalSurat: text("tanggalSurat", 60),
    perihal: text("perihal", 300),
    kanwil: text("kanwil", 200),
    kpknl: text("kpknl", 200),
    status: text("status", 20).toUpperCase() === "LENGKAP" ? "LENGKAP" : "TIDAK LENGKAP",
    kelengkapan: (Array.isArray(r.kelengkapan) ? r.kelengkapan : []).slice(0, 40).map((k) => {
      const item = (k ?? {}) as Record<string, unknown>;
      const t = (key: string, max: number) =>
        typeof item[key] === "string" ? (item[key] as string).trim().slice(0, max) : "";
      return { no: t("no", 10), dok: t("dok", 600), cek: t("cek", 40) };
    }),
  };
  const missing = (["kodeSatker", "satker", "pejabatPemohon", "nomorSurat", "tanggalSurat", "perihal"] as const).filter(
    (k) => !data[k],
  );
  if (missing.length) return { error: `Isian data dokumen belum lengkap: ${missing.join(", ")}.` };
  if (!data.kelengkapan.length) return { error: "Checklist kelengkapan (kelengkapan) wajib diisi." };
  return data;
}

// ---------------------------------------------------------------- pembantu tata letak

interface ParaOptions {
  size?: number;
  bold?: boolean;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  after?: number;
  before?: number;
  indent?: { left: number; hanging: number };
}
const run = (text: string, o: ParaOptions = {}) => new TextRun({ text, font: FONT, size: o.size ?? 24, bold: o.bold });
const para = (text: string, o: ParaOptions = {}) =>
  new Paragraph({
    children: [run(text, o)],
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: { after: o.after ?? 0, before: o.before ?? 0, line: 276 },
    indent: o.indent,
  });
const center = (text: string, o: ParaOptions = {}) => para(text, { ...o, align: AlignmentType.CENTER });
const justify = (text: string, o: ParaOptions = {}) =>
  para(text, { ...o, align: AlignmentType.JUSTIFIED, after: o.after ?? 60 });
const item = (mark: string, text: string, after = 60) =>
  para(`${mark}\t${text}`, { align: AlignmentType.JUSTIFIED, indent: { left: 425, hanging: 425 }, after });

const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NOB = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
const line = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const ALLB = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
const tight = { top: 0, bottom: 80, left: 0, right: 0 };

const cell = (
  children: Paragraph | (Paragraph | Table)[],
  width: number,
  o: {
    borders?: typeof NOB | typeof ALLB;
    fill?: string;
    span?: number;
    margins?: typeof tight;
    v?: "center" | "top";
  } = {},
) =>
  new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: width, type: WidthType.DXA },
    borders: o.borders,
    verticalAlign: o.v === "center" ? VerticalAlign.CENTER : VerticalAlign.TOP,
    columnSpan: o.span,
    shading: o.fill ? { fill: o.fill } : undefined,
    margins: o.margins ?? { top: 40, bottom: 40, left: 80, right: 80 },
  });

/** Baris "Label : isi" tanpa garis (Menimbang, Mengingat, diktum). */
function labelTable(rows: [string, Paragraph[]][], labelW = 2100) {
  const colonW = 300;
  const bodyW = SK_TEXT_W - labelW - colonW;
  return new Table({
    width: { size: SK_TEXT_W, type: WidthType.DXA },
    columnWidths: [labelW, colonW, bodyW],
    layout: TableLayoutType.FIXED,
    borders: NOB,
    rows: rows.map(
      ([label, body]) =>
        new TableRow({
          children: [
            cell(para(label), labelW, { borders: NOB, margins: tight }),
            cell(para(label ? ":" : ""), colonW, { borders: NOB, margins: tight }),
            cell(body, bodyW, { borders: NOB, margins: tight }),
          ],
        }),
    ),
  });
}

function signatureBlock(o: { total: number; width: number; size?: number; prefix?: string[] }) {
  const lines = [
    ...(o.prefix ?? []),
    "a.n. Menteri Perhubungan",
    "Direktur Jenderal Perhubungan Udara",
    "",
    "${ttd_pengirim}",
    "",
    "${nama_pengirim}",
    "NIP. ${nip_pengirim}",
  ];
  return new Table({
    width: { size: o.total, type: WidthType.DXA },
    columnWidths: [o.total - o.width, o.width],
    borders: NOB,
    rows: [
      new TableRow({
        children: [
          cell(para(""), o.total - o.width, { borders: NOB }),
          cell(
            lines.map((t) => para(t, { size: o.size })),
            o.width,
            { borders: NOB },
          ),
        ],
      }),
    ],
  });
}

const totalValue = (assets: SimanDocumentAsset[]) => assets.reduce((s, a) => s + (a.nilaiPerolehan || 0), 0);

// ---------------------------------------------------------------- konsep KM PSP

const MENGINGAT = [
  "Undang-Undang Nomor 39 Tahun 2008 tentang Kementerian Negara (Lembaran Negara Republik Indonesia Tahun 2008 Nomor 166, Tambahan Lembaran Negara Republik Indonesia Nomor 4916) sebagaimana telah diubah dengan Undang-Undang Nomor 61 Tahun 2024;",
  "Peraturan Presiden Nomor 139 Tahun 2024 tentang Penataan Tugas dan Fungsi Kementerian Negara dalam Kabinet Merah Putih Periode Tahun 2024-2029 (Lembaran Negara Republik Indonesia Tahun 2024 Nomor 249);",
  "Peraturan Presiden Nomor 140 Tahun 2024 tentang Organisasi Kementerian Negara (Lembaran Negara Republik Indonesia Tahun 2024 Nomor 250);",
  "Peraturan Presiden Nomor 173 Tahun 2024 tentang Kementerian Perhubungan (Lembaran Negara Republik Indonesia Tahun 2024 Nomor 369);",
  "Peraturan Menteri Keuangan Nomor 4/PMK.06/2015 tentang Pendelegasian Kewenangan dan Tanggung Jawab Tertentu dari Pengelola Barang kepada Pengguna Barang (Berita Negara Republik Indonesia Tahun 2015 Nomor 20);",
  "Peraturan Menteri Keuangan Nomor 40 Tahun 2024 tentang Tata Cara Penggunaan Barang Milik Negara (Berita Negara Republik Indonesia Tahun 2024 Nomor 346);",
  "Peraturan Menteri Perhubungan Nomor PM 17 Tahun 2024 tentang Pengelolaan Barang Milik Negara di Lingkungan Kementerian Perhubungan (Berita Negara Republik Indonesia Tahun 2024 Nomor 447);",
  "Peraturan Menteri Perhubungan Nomor PM 7 Tahun 2026 tentang Perubahan atas Peraturan Menteri Perhubungan Nomor PM 4 Tahun 2025 tentang Organisasi dan Tata Kerja Kementerian Perhubungan (Berita Negara Republik Indonesia Tahun 2026 Nomor 618);",
  "Keputusan Menteri Perhubungan Nomor KM 93 Tahun 2024 tentang Petunjuk Teknis Pelaksanaan Penggunaan Barang Milik Negara di Lingkungan Kementerian Perhubungan; dan",
  "Keputusan Menteri Perhubungan Nomor KM 123 Tahun 2024 tentang Pelimpahan Sebagian Wewenang atau Tanggung Jawab Pengelolaan Barang Milik Negara dari Pengguna Barang dalam Bentuk Delegasi dan Mandat kepada Para Pejabat di Lingkungan Kementerian Perhubungan;",
];

export function decreeDocument(d: SimanDocumentData, assets: SimanDocumentAsset[], garuda: Buffer | null) {
  const unit = assets.length;
  const total = totalValue(assets);
  const satkerUp = d.satker.toUpperCase();
  const head: Paragraph[] = [
    ...(garuda
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: garuda, type: "png", transformation: { width: 91, height: 98 } })],
          }),
        ]
      : []),
    center("KEMENTERIAN PERHUBUNGAN", { bold: true }),
    center("REPUBLIK INDONESIA", { bold: true, after: 240 }),
    center("KEPUTUSAN MENTERI PERHUBUNGAN REPUBLIK INDONESIA", { bold: true }),
    center("NOMOR : ${nomor_naskah}", { bold: true, after: 240 }),
    center("TENTANG", { bold: true, after: 120 }),
    center("PENETAPAN STATUS PENGGUNAAN BARANG MILIK NEGARA", { bold: true }),
    center(`PADA ${satkerUp}`, { bold: true }),
    center("DIREKTORAT JENDERAL PERHUBUNGAN UDARA", { bold: true, after: 240 }),
    center("DENGAN RAHMAT TUHAN YANG MAHA ESA", { bold: true, after: 240 }),
    center("MENTERI PERHUBUNGAN REPUBLIK INDONESIA,", { bold: true, after: 240 }),
  ];
  const menimbang = [
    item(
      "a.",
      "bahwa untuk melaksanakan ketentuan dalam Pasal 4 Peraturan Menteri Perhubungan Nomor PM 17 Tahun 2024 tentang Pengelolaan Barang Milik Negara di Lingkungan Kementerian Perhubungan, Pengguna Barang perlu melakukan penetapan status penggunaan Barang Milik Negara;",
    ),
    item(
      "b.",
      "bahwa Pengguna Barang berwenang dan bertanggung jawab menetapkan status penggunaan Barang Milik Negara;",
    ),
    item(
      "c.",
      `bahwa berdasarkan pertimbangan sebagaimana dimaksud dalam huruf a dan huruf b, perlu menetapkan Keputusan Menteri Perhubungan tentang Penetapan Status Penggunaan Barang Milik Negara pada ${d.satker}, Direktorat Jenderal Perhubungan Udara;`,
    ),
  ];
  const diktum: [string, Paragraph[]][] = [
    [
      "Menetapkan",
      [
        justify(
          `KEPUTUSAN MENTERI PERHUBUNGAN TENTANG PENETAPAN STATUS PENGGUNAAN BARANG MILIK NEGARA PADA ${satkerUp}, DIREKTORAT JENDERAL PERHUBUNGAN UDARA.`,
        ),
      ],
    ],
    [
      "KESATU",
      [
        justify(
          `Menetapkan status penggunaan Barang Milik Negara berupa selain tanah dan/atau bangunan yang tidak memiliki bukti kepemilikan sejumlah ${unit} (${terbilang(unit)}) unit sebagai Barang Milik Negara pada ${d.satker}, sebagaimana tercantum dalam Lampiran yang merupakan bagian tidak terpisahkan dari Keputusan Menteri ini.`,
        ),
      ],
    ],
    [
      "KEDUA",
      [
        justify(
          `Barang Milik Negara sebagaimana dimaksud dalam Diktum KESATU dengan total nilai perolehan sebesar Rp${rupiahText(total)},00 (${terbilang(total)} rupiah).`,
        ),
      ],
    ],
    [
      "KETIGA",
      [
        justify(
          "Barang Milik Negara sebagaimana dimaksud dalam Diktum KESATU agar dicatat dalam Daftar Barang Kuasa Pengguna pada Kuasa Pengguna Barang, Daftar Barang Pengguna pada Pengguna Barang, dan Daftar Barang Milik Negara pada Pengelola Barang.",
        ),
      ],
    ],
    [
      "KEEMPAT",
      [
        justify(
          "Kuasa Pengguna Barang dapat melakukan pemanfaatan atau pemindahtanganan kepada pihak lain setelah mendapat persetujuan Pengelola Barang sesuai dengan ketentuan peraturan perundang-undangan.",
        ),
      ],
    ],
    [
      "KELIMA",
      [
        justify("Kuasa Pengguna Barang sebagaimana dimaksud dalam Diktum KEEMPAT wajib:"),
        item("a.", "melakukan monitoring dan evaluasi atas optimalisasi penggunaan Barang Milik Negara; dan"),
        item("b.", "menyampaikan laporan kepada Pengguna Barang setiap 1 (satu) kali dalam 1 (satu) semester."),
      ],
    ],
    [
      "KEENAM",
      [
        justify(
          "Segala biaya pengamanan dan pemeliharaan Barang Milik Negara yang digunakan oleh Kementerian Perhubungan menjadi tanggung jawab Kementerian Perhubungan.",
        ),
      ],
    ],
    [
      "KETUJUH",
      [
        justify(
          "Apabila di kemudian hari terdapat kekeliruan dalam Keputusan Menteri ini, akan diadakan perbaikan sebagaimana mestinya.",
        ),
      ],
    ],
    ["KEDELAPAN", [justify("Keputusan Menteri ini mulai berlaku pada tanggal ditetapkan.")]],
  ];
  const tembusan = [
    "Ketua Badan Pemeriksa Keuangan;",
    "Menteri Keuangan;",
    "Menteri Perhubungan;",
    "Inspektur Jenderal Kementerian Perhubungan;",
    "Kepala Biro Layanan Pengadaan dan Pengelolaan BMN;",
    "Direktur Jenderal Perhubungan Udara;",
    "Direktur Perumusan Kebijakan Kekayaan Negara, Kementerian Keuangan;",
    "Direktur Pengelolaan Kekayaan Negara, Kementerian Keuangan;",
    ...(d.kanwil ? [`${d.kanwil}; dan`] : []),
    ...(d.kpknl ? [`${d.kpknl}.`] : []),
  ];
  const body = [
    ...head,
    labelTable([
      ["Menimbang", menimbang],
      ["Mengingat", MENGINGAT.map((t, i) => item(`${i + 1}.`, t))],
      [
        "Memperhatikan",
        [justify(`Surat ${d.pejabatPemohon} Nomor ${d.nomorSurat} tanggal ${d.tanggalSurat} perihal ${d.perihal}.`)],
      ],
    ]),
    center("MEMUTUSKAN:", { bold: true, before: 240, after: 240 }),
    labelTable(diktum),
    para("", { after: 240 }),
    signatureBlock({
      total: SK_TEXT_W,
      width: 4600,
      prefix: ["Ditetapkan di Jakarta", "pada tanggal ${tanggal_naskah}", ""],
    }),
    para("", { after: 240 }),
    para("Salinan Keputusan Menteri ini disampaikan kepada:", { after: 60 }),
    ...tembusan.map((t, i) => item(`${i + 1}.`, t, 0)),
  ];

  // Lampiran: F4 mendatar
  const LM = { top: 851, right: 1134, bottom: 1134, left: 1134 };
  const LW = F4.height - LM.left - LM.right;
  const cols = [600, 4300, 1500, 3300, 700, 1100, 1700, 1500, 1700, 1050];
  const scale = LW / cols.reduce((a, b) => a + b, 0);
  const cw = cols.map((c) => Math.floor(c * scale));
  const small = 18;
  const hdr = [
    "No",
    "Kode Register",
    "Kode Barang",
    "Nama Barang",
    "NUP",
    "Kuantitas",
    "Merk/Tipe",
    "Tanggal Perolehan",
    "Nilai Perolehan (Rp)",
    "Kondisi",
  ];
  const tc = (t: string | number, i: number, o: { bold?: boolean; fill?: string; align?: ParaOptions["align"] } = {}) =>
    cell(para(String(t), { size: small, bold: o.bold, align: o.align ?? AlignmentType.CENTER }), cw[i], {
      borders: ALLB,
      v: "center",
      fill: o.fill,
    });
  const rows = [
    new TableRow({ tableHeader: true, children: hdr.map((h, i) => tc(h, i, { bold: true, fill: "D9D9D9" })) }),
    new TableRow({ tableHeader: true, children: hdr.map((_, i) => tc(`(${i + 1})`, i, { bold: true })) }),
    new TableRow({
      children: [
        new TableCell({
          columnSpan: hdr.length,
          borders: ALLB,
          width: { size: LW, type: WidthType.DXA },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: [para(`${d.kodeSatker} / ${satkerUp}`, { size: small, bold: true })],
        }),
      ],
    }),
    ...assets.map(
      (a, i) =>
        new TableRow({
          cantSplit: true,
          children: [
            tc(i + 1, 0),
            tc(a.kodeRegister, 1),
            tc(a.kodeBarang, 2),
            tc(a.namaBarang, 3, { align: AlignmentType.LEFT }),
            tc(a.nup, 4),
            tc(1, 5),
            tc([...new Set([a.merk, a.tipe].filter((v) => v && v !== "-"))].join(" / ") || "-", 6),
            tc(a.tanggalPerolehan.replaceAll("/", "-"), 7),
            tc(rupiahText(a.nilaiPerolehan), 8, { align: AlignmentType.RIGHT }),
            tc(a.kondisi, 9),
          ],
        }),
    ),
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 5,
          borders: ALLB,
          width: { size: cw.slice(0, 5).reduce((a, b) => a + b, 0), type: WidthType.DXA },
          children: [para("JUMLAH", { size: small, bold: true, align: AlignmentType.CENTER })],
        }),
        tc(unit, 5, { bold: true }),
        tc("", 6),
        tc("", 7),
        tc(rupiahText(total), 8, { bold: true, align: AlignmentType.RIGHT }),
        tc("", 9),
      ],
    }),
  ];
  const lampiranHead = new Table({
    width: { size: LW, type: WidthType.DXA },
    columnWidths: [LW - 7600, 1500, 300, 5800],
    borders: NOB,
    rows: [
      ["LAMPIRAN", "KEPUTUSAN MENTERI PERHUBUNGAN REPUBLIK INDONESIA"],
      ["NOMOR", "${nomor_naskah}"],
      ["TANGGAL", "${tanggal_naskah}"],
    ].map(
      ([a, b]) =>
        new TableRow({
          children: [
            cell(para(""), LW - 7600, { borders: NOB }),
            cell(para(a, { size: 20 }), 1500, { borders: NOB, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
            cell(para(":", { size: 20 }), 300, { borders: NOB, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
            cell(para(b, { size: 20 }), 5800, { borders: NOB, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
          ],
        }),
    ),
  });
  const lampiran = [
    lampiranHead,
    para("", { after: 240 }),
    center("DAFTAR BARANG MILIK NEGARA YANG DITETAPKAN STATUS PENGGUNAANNYA", { bold: true, size: 22 }),
    center(`PADA ${satkerUp}`, { bold: true, size: 22 }),
    center("DIREKTORAT JENDERAL PERHUBUNGAN UDARA KEMENTERIAN PERHUBUNGAN", { bold: true, size: 22, after: 200 }),
    new Table({ width: { size: LW, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED, rows }),
    para("", { after: 240 }),
    signatureBlock({ total: LW, width: 5200, size: 22 }),
  ];
  return new Document({
    creator: "Akasha",
    title: `Konsep KM PSP ${d.satker}`,
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [
      { properties: { page: { size: F4, margin: SK_MARGIN } }, children: body },
      {
        properties: {
          page: { size: { width: F4.width, height: F4.height, orientation: PageOrientation.LANDSCAPE }, margin: LM },
        },
        children: lampiran,
      },
    ],
  });
}

// ---------------------------------------------------------------- Dokumen Analisis

export function analysisDocument(d: SimanDocumentData, assets: SimanDocumentAsset[]) {
  const W = A4.width - ANALYSIS_MARGIN.left - ANALYSIS_MARGIN.right;
  const unit = assets.length;
  const total = totalValue(assets);
  const noMargin = { top: 0, bottom: 40, left: 0, right: 0 };
  const ident = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3000, 300, W - 3300],
    borders: NOB,
    rows: [
      ["Satuan Kerja", `${d.satker} (${d.kodeSatker})`],
      ["Nomor Tiket SIMAN", d.ticket],
      ["Surat Permohonan", `${d.nomorSurat} tanggal ${d.tanggalSurat}`],
      ["Jenis BMN", "Selain Tanah dan/atau Bangunan"],
      ["Jumlah / Nilai Perolehan", `${unit} unit / Rp${rupiahText(total)},00`],
    ].map(
      ([a, b]) =>
        new TableRow({
          children: [
            cell(para(a, { size: 22 }), 3000, { borders: NOB, margins: noMargin }),
            cell(para(":", { size: 22 }), 300, { borders: NOB, margins: noMargin }),
            cell(para(b, { size: 22 }), W - 3300, { borders: NOB, margins: noMargin }),
          ],
        }),
    ),
  });
  const cw = [800, W - 800 - 2000, 2000];
  const tc = (t: string, i: number, o: { bold?: boolean; fill?: string; align?: ParaOptions["align"] } = {}) =>
    cell(para(t, { size: 22, bold: o.bold, align: o.align ?? AlignmentType.LEFT }), cw[i], {
      borders: ALLB,
      fill: o.fill,
      v: "center",
    });
  const head = { bold: true, fill: "D9D9D9", align: AlignmentType.CENTER };
  const check = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: cw,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [tc("No.", 0, head), tc("Dokumen/Data Pendukung", 1, head), tc("Cek (Ada/Tidak)", 2, head)],
      }),
      ...d.kelengkapan.map(
        (k) =>
          new TableRow({
            children: [
              tc(k.no, 0, { align: AlignmentType.CENTER }),
              tc(k.dok, 1),
              tc(k.cek, 2, { align: AlignmentType.CENTER }),
            ],
          }),
      ),
    ],
  });
  const status = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W - 2800, 2800],
    rows: [
      new TableRow({
        children: [
          cell(para("STATUS", { bold: true, size: 22, align: AlignmentType.CENTER }), W - 2800, { borders: ALLB }),
          cell(para(d.status, { bold: true, size: 22, align: AlignmentType.CENTER }), 2800, { borders: ALLB }),
        ],
      }),
    ],
  });
  const signer = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W - 4200, 4200],
    borders: NOB,
    rows: [
      new TableRow({
        children: [
          cell(para(""), W - 4200, { borders: NOB }),
          cell(
            [
              para("Verifikator", { size: 22 }),
              para("", { after: 600 }),
              para("${ttd_pengirim}", { size: 22 }),
              para("", { after: 200 }),
              para("${nama_pengirim}", { size: 22, bold: true }),
              para("NIP. ${nip_pengirim}", { size: 22 }),
            ],
            4200,
            { borders: NOB },
          ),
        ],
      }),
    ],
  });
  return new Document({
    creator: "Akasha",
    title: `Dokumen Analisis PSP ${d.satker}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: { page: { size: A4, margin: ANALYSIS_MARGIN } },
        children: [
          center("DOKUMEN ANALISIS", { bold: true }),
          center("USULAN PENETAPAN STATUS PENGGUNAAN (PSP) BMN SELAIN TANAH/BANGUNAN", { bold: true }),
          center("KEPADA DIREKTUR JENDERAL PERHUBUNGAN UDARA", { bold: true, after: 200 }),
          ident,
          para("", { after: 120 }),
          center("CHECKLIST KELENGKAPAN DOKUMEN", { bold: true, size: 22, after: 120 }),
          check,
          para("", { after: 120 }),
          status,
          para("", { after: 360 }),
          signer,
        ],
      },
    ],
  });
}

/**
 * Pasang kop dari templat Surat Dinas: tiga paragraf pertama templat (gambar kop mengambang + dua paragraf jarak) dan
 * sectPr-nya (A4, margin) dipertahankan, isi surat diganti badan dokumen hasil `docx`. Templat tanpa gambar di paragraf
 * pertama = galat (bukan kop yang dikenali).
 */
export function withLetterhead(generated: Buffer, template: Buffer): Buffer {
  const tpl = new PizZip(template);
  const gen = new PizZip(generated);
  const tplXml = tpl.file("word/document.xml")?.asText() ?? "";
  const genXml = gen.file("word/document.xml")?.asText() ?? "";
  const tplBody = tplXml.slice(tplXml.indexOf("<w:body>") + 8, tplXml.lastIndexOf("</w:body>"));
  const paras = [...tplBody.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].slice(0, 3).map((m) => m[0]);
  if (!paras[0]?.includes("<w:drawing>")) throw new Error("Kop pada templat Surat Dinas tidak ditemukan.");
  const sectPr = tplBody.slice(tplBody.lastIndexOf("<w:sectPr"));
  const genBody = genXml.slice(genXml.indexOf("<w:body>") + 8, genXml.lastIndexOf("</w:body>"));
  const content = genBody.slice(0, genBody.lastIndexOf("<w:sectPr"));
  tpl.file(
    "word/document.xml",
    tplXml.slice(0, tplXml.indexOf("<w:body>") + 8) + paras.join("") + content + sectPr + "</w:body></w:document>",
  );
  return tpl.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export const packDocument = (doc: Document) => Packer.toBuffer(doc);

/** Nama berkas aman. */
export function documentFileName(kind: "analysis" | "decree", d: SimanDocumentData) {
  const satker = d.satker.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 90);
  return kind === "analysis"
    ? `Dokumen Analisis PSP - ${satker} (${d.ticket}).docx`
    : `Konsep KM PSP - ${satker} (${d.ticket}).docx`;
}

/**
 * Perbandingan teks dokumen buatan agen vs isi sekarang (setelah disunting pemilik di ONLYOFFICE), per baris: baris yang
 * hilang & baris baru, urutan dipertahankan, maks. `limit` per sisi. Dipakai agen untuk belajar dari suntingan pemilik.
 */
export function textChanges(original: string, current: string, limit = 80) {
  const lines = (t: string) =>
    t
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const a = lines(original);
  const b = lines(current);
  const count = (list: string[]) => list.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const inB = count(b);
  const inA = count(a);
  const removed: string[] = [];
  for (const l of a) {
    const n = inB.get(l) ?? 0;
    if (n > 0) inB.set(l, n - 1);
    else removed.push(l);
  }
  const added: string[] = [];
  for (const l of b) {
    const n = inA.get(l) ?? 0;
    if (n > 0) inA.set(l, n - 1);
    else added.push(l);
  }
  return {
    changed: removed.length > 0 || added.length > 0,
    removedCount: removed.length,
    addedCount: added.length,
    removed: removed.slice(0, limit),
    added: added.slice(0, limit),
  };
}
