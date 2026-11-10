/**
 * Logika murni Pencarian Pintar (Ctrl+K → Pintar): menemukan item & berkas di semua modul lewat indeks yang sama dengan
 * chatbot, tanpa model generatif. Diuji di `smart-search.spec.ts`.
 */

export const SMART_MODULES = [
  "planner",
  "notes",
  "productivity",
  "file_control",
  "files",
  "knowledge",
  "other",
] as const;
export type SmartModule = (typeof SMART_MODULES)[number];

export const SMART_SEARCH_MODES = ["text", "meaning"] as const;
export type SmartSearchMode = (typeof SMART_SEARCH_MODES)[number];

const MODULE_BY_SOURCE: Record<string, SmartModule> = {
  schedule: "planner",
  routine: "planner",
  todo: "planner",
  free_note: "notes",
  ai_note: "notes",
  list: "notes",
  notebook_source: "notes",
  para_area: "productivity",
  para_project: "productivity",
  para_activity: "productivity",
  para_task: "productivity",
  para_resource: "productivity",
  para_archive: "productivity",
  archive_classification: "file_control",
  archive_jra: "file_control",
  archive_physical_reference: "file_control",
  archive_borrowing: "file_control",
  archive_disposition: "file_control",
  asset: "files",
  obsidian: "knowledge",
  obsidian_canvas: "knowledge",
};

/** Resource yang sudah masuk File Control (status kearsipan selain kosong/`none`) dikelompokkan ke File Control. */
export const isFileControlStatus = (status?: string | null) => !!status && status !== "none";

export function moduleOf(sourceType: string, archivalStatus?: string | null): SmartModule {
  if (sourceType === "para_resource" && isFileControlStatus(archivalStatus)) return "file_control";
  return MODULE_BY_SOURCE[sourceType] ?? "other";
}

/** Kata kueri (huruf & angka saja, huruf kecil), maks. 8 — aman disusun menjadi `to_tsquery`. */
export function queryTerms(query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, 8);
}

/**
 * Kueri awalan untuk pencarian saat mengetik: "nota din" → `nota:* & din:*` (kata terakhir boleh belum lengkap).
 * Kosong = tidak ada kata yang bisa dicari.
 */
export function prefixTsQuery(query: string, anyWord = false) {
  return queryTerms(query)
    .map((word) => `${word}:*`)
    .join(anyWord ? " | " : " & ");
}

/** Pola ILIKE judul (karakter khusus di-escape). */
export const likePattern = (query: string) => `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Cuplikan di sekitar kata kueri pertama yang ditemukan (tanpa peka huruf besar/kecil & aksen); tanpa kecocokan =
 * awal teks. Spasi dirapatkan dan potongan diberi elipsis.
 */
export function searchSnippet(content: string, query: string, max = 220) {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const folded = fold(text);
  const positions = queryTerms(query)
    .map((word) => folded.indexOf(fold(word)))
    .filter((i) => i >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, hit - Math.floor(max / 3));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space > 0 && space - start < 20) start = space + 1;
  }
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Kolom record yang tidak bermakna dibaca sebagai cuplikan (status teknis, jenis berkas, tanggal retensi). */
const NOISE_KEYS = new Set([
  "type",
  "mimeType",
  "status",
  "archivalStatus",
  "isAutoDispose",
  "isVital",
  "retentionActiveDate",
  "retentionInactiveDate",
  "completed",
  "completedAt",
  "active",
  "isAllDay",
]);

/**
 * Teks record terindeks berbentuk baris `kunci: nilai` → nilai-nilai yang bermakna saja, dipisah " · ", untuk cuplikan
 * yang mudah dibaca (tidak mengubah indeks).
 */
export function readableRecordText(content: string) {
  return content
    .split("\n")
    .map((line) => {
      const field = /^([A-Za-z][\w]*): (.*)$/.exec(line.trim());
      if (!field) return line.trim();
      const [, key = "", value = ""] = field;
      if (NOISE_KEYS.has(key) || value === "true" || value === "false") return "";
      return value.trim();
    })
    .filter(Boolean)
    .join(" · ");
}

/** Judul potongan memuat label jenis ("Resource: X", "Berkas: Y") → tampilkan nama itemnya saja. */
export const displayTitle = (title: string) => title.replace(/^[^:\n]{1,40}:\s*/, "").trim() || title;

export interface GroupableHit {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
}

/** Satu baris per item: potongan terbaik (urutan peringkat dipertahankan) + jumlah potongan yang cocok. */
export function groupBySource<T extends GroupableHit>(hits: T[]) {
  const groups = new Map<string, { hit: T; matches: number }>();
  for (const hit of hits) {
    const key = `${hit.sourceType}\u0000${hit.sourceId}`;
    const group = groups.get(key);
    if (group) group.matches += 1;
    else groups.set(key, { hit, matches: 1 });
  }
  return [...groups.values()];
}

/** Tab File Control untuk status kearsipan resource. */
export function fileControlTab(status?: string | null): "pending" | "physical" | "digital" {
  return status === "physical" || status === "digital" ? status : "pending";
}
