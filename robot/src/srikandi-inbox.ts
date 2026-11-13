import { parseIndonesianDate } from "./srikandi.js";
import { headerName } from "./srikandi-reference.js";

/**
 * Logika murni Naskah Masuk SRIKANDI (diuji di `srikandi-inbox.test.ts`). Halaman daftar `/penerimaan-naskah-masuk/…`
 * dipetakan 2026-11-13 (docs/AI-AGENT.md §21.14). Robot **hanya membaca halaman daftar**: detail naskah tidak pernah
 * dibuka karena bisa mengubah Status Baca di SRIKANDI, dan tidak ada tombol yang diklik selain Hitung Total & halaman
 * berikutnya.
 */

export const INBOX_PAGES = [
  { kind: "masuk", path: "/penerimaan-naskah-masuk/naskah-dinas-masuk" },
  { kind: "tembusan", path: "/penerimaan-naskah-masuk/naskah-tembusan" },
  { kind: "disposisi", path: "/penerimaan-naskah-masuk/disposisi" },
  { kind: "koordinasi", path: "/penerimaan-naskah-masuk/koordinasi" },
  { kind: "arahan", path: "/penerimaan-naskah-masuk/arahan" },
] as const;

export type InboxKind = (typeof INBOX_PAGES)[number]["kind"];

/** Batas halaman per daftar (10 baris per halaman di SRIKANDI). */
export const MAX_INBOX_PAGES = 30;

export interface InboxItem {
  kind: InboxKind;
  /** Tanggal naskah (YYYY-MM-DD) — untuk disposisi/koordinasi/arahan = Tanggal Naskah Masuk */
  date: string;
  /** Tanggal disposisi / koordinasi / arahan (YYYY-MM-DD) */
  sentDate: string;
  number: string;
  subject: string;
  origin: string;
  /** Uraian Informasi (disposisi, koordinasi, arahan) */
  info: string;
  instruction: string;
  extraInstruction: string;
  followUpStatus: string;
  readStatus: string;
  /** Semua kolom terbaca (judul dinormalkan → isi) */
  fields: Record<string, string>;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** Kolom yang tidak disimpan (nomor urut, centang, tombol aksi). */
const SKIP = /^(#|no|aksi)$/i;

/** "Tidak ada data ditemukan", baris filter ("Cari …"), dan baris memuat bukan data. */
const NOT_DATA = /tidak ada data|data tidak ditemukan|^cari\b|mohon tunggu|memuat/i;

export function inboxRequestedKinds(value: unknown): InboxKind[] {
  const all = INBOX_PAGES.map((p) => p.kind) as InboxKind[];
  if (!Array.isArray(value)) return all;
  const wanted = all.filter((k) => value.includes(k));
  return wanted.length ? wanted : all;
}

/**
 * Baris tabel → butir naskah masuk. Sel diselaraskan ke judul dari kanan (kolom "#" berisi centang tidak selalu punya
 * sel), seperti tabel referensi. Baris kosong / filter / "tidak ada data" dibuang.
 */
export function parseInboxRows(kind: InboxKind, headers: string[], rows: string[][]): InboxItem[] {
  const all = headers.map(headerName);
  const items: InboxItem[] = [];
  for (const raw of rows) {
    const cells = raw.map(tidy);
    if (cells.length < 3 || cells.length > all.length + 1) continue;
    // Baris filter berisi teks "Cari …" di beberapa kolom; baris keterangan hanya berisi satu teks
    if (cells.filter((c) => /^cari\b/i.test(c)).length >= 2) continue;
    if (cells.filter(Boolean).length <= 1 && cells.some((c) => NOT_DATA.test(c))) continue;
    const names = cells.length >= all.length ? all : all.slice(all.length - cells.length);
    const aligned = cells.length > all.length ? cells.slice(cells.length - all.length) : cells;
    const fields: Record<string, string> = {};
    aligned.forEach((value, i) => {
      const header = names[i];
      if (!header || SKIP.test(header) || !value || value === "-") return;
      fields[header] = value;
    });
    const get = (...keys: string[]) => keys.map((k) => fields[k]).find(Boolean) ?? "";
    const sentDateText = get("Tanggal Disposisi", "Tanggal Koordinasi", "Tanggal Arahan");
    const item: InboxItem = {
      kind,
      date: parseIndonesianDate(get("Tanggal Naskah", "Tanggal Naskah Masuk")),
      sentDate: parseIndonesianDate(sentDateText),
      number: get("Nomor Naskah"),
      subject: get("Hal"),
      origin: get("Asal Naskah"),
      info: get("Uraian Informasi"),
      instruction: get("Instruksi"),
      extraInstruction: get("Instruksi Tambahan"),
      followUpStatus: get("Status Tindak Lanjut"),
      readStatus: get("Status Baca"),
      fields,
    };
    if (!item.number && !item.subject && !item.info && !item.instruction) continue;
    items.push(item);
  }
  return items;
}

/** Kunci stabil satu butir (ID detail SRIKANDI acak per muat, jadi tidak bisa dipakai). */
export const inboxKey = (
  item: Pick<InboxItem, "kind" | "date" | "sentDate" | "number" | "subject" | "info" | "instruction">,
) =>
  [item.kind, item.number, item.date, item.sentDate, item.subject || item.info, item.instruction]
    .map((v) => tidy(v).toLowerCase())
    .join("|");

/** Gabungkan hasil beberapa halaman tanpa ganda (halaman terakhir bisa terbaca dua kali). */
export function mergeInboxItems(pages: InboxItem[][]): InboxItem[] {
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const item of pages.flat()) {
    const key = inboxKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
