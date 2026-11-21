import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * Mesin templat DOCX (tahap 4 docs/AI-AGENT.md): templat instansi memakai penanda gaya SRIKANDI `${nama_isian}` dan
 * paragraf petunjuk `[Paragraf pembuka: …]`. Penanda diisi nilai dari pengajuan/AI; paragraf petunjuk diganti teks yang
 * ditulis AI (format paragraf asli dipertahankan). Penanda milik SRIKANDI (nomor & tanggal naskah, tanda tangan) dan
 * penanda tanpa nilai **dibiarkan utuh** agar tetap bisa diisi SRIKANDI / user. Diuji di `template-engine.spec.ts`.
 */

/**
 * Penanda yang diisi SRIKANDI dari formulir registrasi, penomoran, & tanda tangan elektronik — tidak pernah diisi Akasha.
 * Akhiran angka = penandatangan / tujuan ke-n (`nama_pengirim2`).
 */
export const isSrikandiTag = (tag: string) =>
  /^(nomor_naskah|tanggal_naskah|ttd(_.*)?|(jabatan_tujuan|jabatan_pengirim|nama_pengirim|nip_pengirim)\d*)$/i.test(
    tag,
  );

/** Nama isian paragraf petunjuk ke-n (dipakai sebagai penanda sementara saat mengisi). */
const slotName = (index: number) => `__petunjuk_${index + 1}`;
const isSlotName = (name: string) => /^__petunjuk_\d+$/.test(name);

export interface TemplateSlot {
  name: string;
  /** Petunjuk di dalam kurung siku, mis. "Paragraf pembuka: dasar/latar belakang …" */
  instruction: string;
}

export interface TemplateAnalysis {
  /** Penanda `${…}` unik sesuai urutan kemunculan (di luar tabel berulang) */
  tags: string[];
  slots: TemplateSlot[];
  /** Tabel/daftar berulang `${#nama}…${/nama}` → penanda di dalamnya (diisi per baris) */
  loops?: { name: string; tags: string[] }[];
}

/** Satu baris tabel berulang: { penanda: teks }. */
export type TemplateRow = Record<string, string>;
/** Nilai isian: teks untuk penanda & paragraf petunjuk, daftar baris untuk tabel berulang `${#nama}…${/nama}`. */
export type TemplateValues = Record<string, string | TemplateRow[]>;

/** Batas baris tabel berulang (mis. lampiran daftar aset). */
export const MAX_LOOP_ROWS = 3_000;

/** Bersihkan nilai isian dari luar (API/agen): teks, atau daftar baris berisi teks (maks. MAX_LOOP_ROWS). */
export function templateValues(raw: unknown): TemplateValues {
  const out: TemplateValues = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) {
      out[key] = value
        .slice(0, MAX_LOOP_ROWS)
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v : v == null ? "" : String(v)]),
          ),
        );
    }
  }
  return out;
}

const DOC_PATH = "word/document.xml";
const PARAGRAPH = /<w:p(?=[\s>])[\s\S]*?<\/w:p>/g;
const TEXT_NODE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const paragraphText = (xml: string) => decode([...xml.matchAll(TEXT_NODE)].map((m) => m[1]).join(""));

/** Isi kurung siku bila seluruh paragraf berbentuk `[ … ]` (petunjuk penulisan), selain itu null. */
export function instructionOf(text: string) {
  const match = /^\s*\[([\s\S]{3,})\]\s*$/.exec(text);
  return match ? match[1].trim() : null;
}

/** Baris-baris tidak kosong dari teks isian paragraf petunjuk. */
const slotLines = (value: string | undefined) =>
  (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Ganti setiap paragraf petunjuk `[…]` dengan satu run berisi penanda `${__petunjuk_n}` — properti paragraf (`w:pPr`)
 * dan format run pertama (`w:rPr`) dipertahankan agar teks hasil AI mengikuti gaya templat. Isian yang terdiri dari
 * beberapa baris menjadi beberapa paragraf bergaya sama (bukan pindah baris dalam satu paragraf — pada paragraf rata
 * kiri-kanan baris sebelum pindah baris ikut diregangkan).
 */
function markSlots(documentXml: string, values: Record<string, string> = {}) {
  const slots: TemplateSlot[] = [];
  const xml = documentXml.replace(PARAGRAPH, (paragraph) => {
    const instruction = instructionOf(paragraphText(paragraph));
    if (!instruction) return paragraph;
    const open = /^<w:p(?=[\s>])[^>]*>/.exec(paragraph)![0];
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
    const rPr = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(paragraph)?.[1] ?? "";
    const name = slotName(slots.length);
    slots.push({ name, instruction });
    const lines = slotLines(values[name]);
    const keys = lines.length > 1 ? lines.map((_, i) => `${name}__${i + 1}`) : [name];
    return keys.map((key) => `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">\${${key}}</w:t></w:r></w:p>`).join("");
  });
  return { xml, slots };
}

function loadZip(buffer: Buffer) {
  const zip = new PizZip(buffer);
  if (!zip.file(DOC_PATH)) throw new Error("Berkas bukan dokumen Word (.docx) yang valid.");
  return zip;
}

const createDoc = (zip: PizZip, values: TemplateValues) =>
  new Docxtemplater(zip, {
    delimiters: { start: "${", end: "}" },
    paragraphLoop: true,
    linebreaks: true,
    // Penanda tanpa nilai (termasuk milik SRIKANDI) dikembalikan apa adanya
    nullGetter: (part) => (part.module ? "" : `\${${part.value}}`),
    parser: (tag) => ({
      get: (scope: Record<string, unknown>) => {
        const key = tag.trim();
        if (isSrikandiTag(key)) return undefined;
        const value = scope[key];
        // Tabel berulang: daftar baris (kosong = baris contoh di templat dihapus)
        if (Array.isArray(value)) return value;
        return typeof value === "string" && value.trim() ? value : undefined;
      },
    }),
  }).render(values);

/** Daftar penanda & paragraf petunjuk dalam templat (tanpa mengubah berkas). */
export function analyzeTemplate(buffer: Buffer): TemplateAnalysis {
  const zip = loadZip(buffer);
  const { xml, slots } = markSlots(zip.file(DOC_PATH)!.asText());
  const text = paragraphText(xml.replace(/<\/w:p>/g, "</w:p>\n"));
  const tagsIn = (s: string) =>
    [...new Set([...s.matchAll(/\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g)].map((m) => m[1]))].filter((t) => !isSlotName(t));
  const loops: TemplateAnalysis["loops"] = [];
  const outside = text.replace(
    /\$\{\s*#([A-Za-z0-9_]+)\s*\}([\s\S]*?)\$\{\s*\/\1\s*\}/g,
    (_m, name: string, inner: string) => {
      loops.push({ name, tags: tagsIn(inner) });
      return "";
    },
  );
  return { tags: tagsIn(outside), slots, loops };
}

/**
 * Yang masih kosong di dokumen hasil isian, kecuali penanda yang diisi SRIKANDI saat tanda tangan: penanda `${x}` & petunjuk `[…]`.
 * Dokumen seperti ini tidak boleh lolos persetujuan otomatis.
 */
export function unfilledFields(buffer: Buffer) {
  const { tags, slots } = analyzeTemplate(buffer);
  return [...tags.filter((tag) => !isSrikandiTag(tag)), ...slots.map((slot) => `[${slot.instruction.slice(0, 60)}]`)];
}

/**
 * Isi templat: nilai penanda + teks paragraf petunjuk (`__petunjuk_n`). Paragraf petunjuk tanpa teks dibiarkan berisi
 * petunjuk aslinya (dalam kurung siku) agar user tahu bagian mana yang masih harus ditulis.
 */
export function fillTemplate(buffer: Buffer, values: TemplateValues): Buffer {
  const zip = loadZip(buffer);
  const texts = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === "string")) as Record<
    string,
    string
  >;
  const { xml, slots } = markSlots(zip.file(DOC_PATH)!.asText(), texts);
  zip.file(DOC_PATH, xml);
  const scope: TemplateValues = { ...values };
  for (const slot of slots) {
    const lines = slotLines(texts[slot.name]);
    if (!lines.length) scope[slot.name] = `[${slot.instruction}]`;
    else if (lines.length > 1) lines.forEach((line, i) => (scope[`${slot.name}__${i + 1}`] = line));
  }
  const doc = createDoc(zip, scope);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
