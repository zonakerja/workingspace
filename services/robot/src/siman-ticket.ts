/**
 * Logika murni job **Baca tiket SIMAN** (diuji `siman-ticket.test.ts`).
 *
 * Robot membuka satu tiket di halaman Penetapan Pengelolaan (atau Permohonan Pengelolaan) lalu membaca Informasi Umum, tab
 * Daftar Aset (semua halaman), Kelengkapan Dokumen (+ mengunduh berkasnya), Dokumen Analisis, Surat/Keputusan, dan Riwayat
 * Tiket. Robot **tidak pernah** mengubah tiket: tidak mengunggah, tidak menyetujui, tidak memproses. Satu-satunya klik yang
 * mengubah keadaan adalah mengaktifkan peran (mis. Analis Eselon 1) bila belum aktif — tanpa itu SIMAN menolak membuka
 * halaman pengelolaan (keputusan pemilik 2026-11-19).
 */

export const TICKET_PATTERN = /^PPL\d{14,20}$/;

export type TicketSource = "penetapan" | "permohonan";

export const LIST_PATH: Record<TicketSource, string> = {
  penetapan: "/pengelolaan/penetapan-permohonan",
  permohonan: "/pengelolaan/permohonan",
};

/** Tab detail tiket yang dibaca (nama persis di SIMAN). Penetapan punya Disposisi Analis & Surat/Keputusan. */
export const DETAIL_TABS = [
  "Disposisi Analis",
  "Daftar Aset",
  "Kelengkapan Dokumen",
  "Dokumen Analisis",
  "Surat/Keputusan",
  "Riwayat Tiket",
] as const;

/**
 * Tombol yang tidak boleh diklik robot di halaman tiket. Ikon tanpa teks (mata, unduh) diperiksa lewat posisinya di kolom
 * Aksi; tombol bertulisan diperiksa dengan pola ini sebelum diklik.
 */
export const TICKET_FORBIDDEN_BUTTON =
  /(hapus|delete|kirim|ajukan|setuju|tolak|simpan|upload|unggah|tambah|proses|terbit|batal|kembalikan|disposisi baru|tte|tanda tangan)/i;

/** Label Informasi Umum di panel kiri detail tiket. */
export const INFO_LABELS = [
  "Nomor Tiket",
  "Tipe Pengelolaan",
  "Status Permohonan",
  "Durasi Penetapan",
  "Durasi Permohonan",
  "Posisi Tiket",
  "Jenis Aset",
  "Penetapan",
  "Asal Permohonan",
  "Kode Satker",
  "Pemohon",
  "Termohon",
  "Nomor Surat Pemohon",
  "Termohon (Penandatangan)",
  "Nilai Kewenangan",
  "Nilai Permohonan",
  "Nilai Perolehan",
  "Nilai Buku",
] as const;

export interface SequenceItem {
  /** "label" = teks label, "value" = isi kotak/tombol */
  kind: "label" | "value";
  text: string;
}

/**
 * Urutan label & nilai panel Informasi Umum → objek label → nilai. Label yang muncul dua kali (mis. "Pemohon" di panel kiri
 * = nama satker, di kepala halaman = "Satker") disimpan dengan akhiran " (2)".
 */
export function parseInfo(sequence: SequenceItem[]): Record<string, string> {
  const labels = new Set<string>(INFO_LABELS);
  const out: Record<string, string> = {};
  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    if (item.kind !== "label" || !labels.has(item.text)) continue;
    const next = sequence[i + 1];
    const value = next && next.kind === "value" ? next.text.trim() : "";
    const key = item.text in out ? `${item.text} (2)` : item.text;
    out[key] = value;
  }
  return out;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  total: number | null;
  /** Isi panel sebagai teks bila tidak berupa tabel (mis. linimasa Riwayat Tiket) */
  text?: string;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Baris tabel → objek per judul kolom (kolom kosong/centang/Aksi dibuang). */
export function rowsToObjects(table: Pick<TableData, "headers" | "rows">): Record<string, string>[] {
  const keep = table.headers.map((h, i) => ({ h: clean(h), i })).filter(({ h }) => h && !/^(aksi|test)$/i.test(h));
  return table.rows.map((cells) => Object.fromEntries(keep.map(({ h, i }) => [h, clean(cells[i] ?? "")])));
}

const num = (text: string | undefined) => {
  const digits = (text ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};

export interface TicketAsset {
  kodeBarang: string;
  nup: string;
  namaBarang: string;
  kodeRegister: string;
  merk: string;
  tipe: string;
  tanggalPerolehan: string;
  nilaiPerolehan: number;
  nilaiBuku: number;
  nilaiPermohonan: number;
  kondisi: string;
  keterangan: string;
}

/** Objek baris tab Daftar Aset → aset terstruktur (judul kolom SIMAN, nilai "Rp 1.720.500" → angka). */
export function toAsset(row: Record<string, string>): TicketAsset {
  return {
    kodeBarang: row["Kode Barang"] ?? "",
    nup: row["NUP"] ?? "",
    namaBarang: row["Nama Barang"] ?? "",
    kodeRegister: row["Kode Register"] ?? "",
    merk: row["Merk"] ?? "",
    tipe: row["Tipe"] ?? "",
    tanggalPerolehan: row["Tanggal Perolehan"] ?? "",
    nilaiPerolehan: num(row["Nilai Perolehan"]),
    nilaiBuku: num(row["Nilai Buku"]),
    nilaiPermohonan: num(row["Nilai Permohonan"]),
    kondisi: row["Kondisi"] ?? "",
    keterangan: row["Keterangan"] ?? "",
  };
}

/** "Total Rows 36" → 36. */
export function parseTotalRows(text: string): number | null {
  const m = /Total Rows\s*([\d.]+)/i.exec(clean(text));
  return m ? Number(m[1].replace(/\./g, "")) : null;
}

/** Ringkasan aset: jumlah & total nilai, dan apakah cocok dengan Nilai Permohonan di kepala tiket. */
export function assetSummary(assets: TicketAsset[], info: Record<string, string>) {
  const perolehan = assets.reduce((s, a) => s + a.nilaiPerolehan, 0);
  const permohonan = assets.reduce((s, a) => s + a.nilaiPermohonan, 0);
  const header = num(info["Nilai Permohonan"]);
  return {
    jumlah: assets.length,
    nilaiPerolehan: perolehan,
    nilaiPermohonan: permohonan,
    cocokDenganKepala: header ? header === permohonan : null,
    kondisi: assets.reduce<Record<string, number>>((acc, a) => {
      const k = a.kondisi || "-";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

/** Nama berkas aman untuk disimpan (dari kolom Nama File SIMAN). */
export function safeFileName(name: string, fallback: string): string {
  const base = clean(name)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 150);
  return base || fallback;
}
