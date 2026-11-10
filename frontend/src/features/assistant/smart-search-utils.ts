import { recordSourcePath } from "@/features/knowledge/knowledge-utils";
import { links } from "@/lib/deep-links";
import type { SmartModule, SmartSearchResult } from "@/types/api";

/** Logika murni Pencarian Pintar (Ctrl+K → Pintar), diuji di `smart-search-utils.test.ts`. */

export const MODULE_INFO: Record<SmartModule, { label: string; tone: string }> = {
  planner: { label: "Planner", tone: "text-mod-planner" },
  notes: { label: "Notes", tone: "text-mod-notes" },
  productivity: { label: "Productivity", tone: "text-mod-productivity" },
  file_control: { label: "File Control", tone: "text-mod-files" },
  files: { label: "Berkas", tone: "text-info" },
  knowledge: { label: "Knowledge", tone: "text-mod-knowledge" },
  other: { label: "Lainnya", tone: "text-muted-foreground" },
};

/** Urutan chip filter modul. */
export const MODULE_ORDER: SmartModule[] = [
  "planner",
  "notes",
  "productivity",
  "file_control",
  "files",
  "knowledge",
  "other",
];

/** Jenis item per sumber (label kecil di samping judul). */
const KIND_LABEL: Record<string, string> = {
  schedule: "Agenda",
  routine: "Rutinitas",
  todo: "To-do",
  free_note: "Catatan Bebas",
  ai_note: "Notes AI",
  list: "List",
  notebook_source: "Sumber notebook",
  para_area: "Area",
  para_project: "Project",
  para_activity: "Kegiatan Area",
  para_task: "Action/Task",
  para_resource: "Resource",
  para_archive: "Arsip PARA",
  archive_classification: "Klasifikasi",
  archive_jra: "JRA",
  archive_physical_reference: "Lokasi fisik",
  archive_borrowing: "Peminjaman",
  archive_disposition: "Penyusutan",
  asset: "Berkas",
  obsidian: "Catatan vault",
  obsidian_canvas: "Canvas",
};

const ARCHIVAL_LABEL: Record<string, string> = {
  pending: "Gantung",
  physical: "Fisik",
  digital: "Digital",
};

export function kindLabel(result: SmartSearchResult) {
  if (result.sourceType === "para_resource" && result.archivalStatus && ARCHIVAL_LABEL[result.archivalStatus])
    return `Arsip ${ARCHIVAL_LABEL[result.archivalStatus]}`;
  return KIND_LABEL[result.sourceType] ?? result.sourceType;
}

export type SmartTarget =
  | { kind: "knowledge"; noteId: string }
  | { kind: "file"; uploadId: string; name: string; mimeType?: string }
  | { kind: "page"; path: string }
  | { kind: "none" };

const fileControlTab = (status?: string | null) => (status === "physical" || status === "digital" ? status : "pending");

/** Ke mana hasil dibuka: catatan vault (dialog), berkas (pratinjau), atau halaman item LifeOS. */
export function smartTarget(result: SmartSearchResult): SmartTarget {
  const { sourceType, sourceId } = result;
  switch (sourceType) {
    case "obsidian":
      return { kind: "knowledge", noteId: sourceId };
    case "obsidian_canvas":
      return { kind: "page", path: links.knowledgeCanvas(sourceId) };
    case "asset":
      return {
        kind: "file",
        uploadId: sourceId,
        name: result.fileName ?? result.title,
        ...(result.mimeType ? { mimeType: result.mimeType } : {}),
      };
    case "notebook_source":
      return { kind: "page", path: links.notebook(result.notebookId ?? undefined) };
    case "para_resource":
      return result.module === "file_control"
        ? { kind: "page", path: links.archive(sourceId, fileControlTab(result.archivalStatus)) }
        : { kind: "page", path: links.resource(sourceId) };
    case "para_archive":
      return { kind: "page", path: "/productivity/archives" };
    case "archive_classification":
    case "archive_jra":
    case "archive_physical_reference":
      return { kind: "page", path: "/file-control/references" };
    case "archive_borrowing":
    case "archive_disposition":
      return { kind: "page", path: "/file-control/transactions" };
    default: {
      const path = recordSourcePath(sourceType, sourceId);
      return path ? { kind: "page", path } : { kind: "none" };
    }
  }
}

/** Jumlah hasil per modul (untuk chip filter). */
export function moduleCounts(results: SmartSearchResult[]) {
  const counts = new Map<SmartModule, number>();
  for (const r of results) counts.set(r.module, (counts.get(r.module) ?? 0) + 1);
  return MODULE_ORDER.filter((m) => counts.has(m)).map((module) => ({ module, count: counts.get(module) ?? 0 }));
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Potong teks menjadi bagian biasa & bagian yang cocok dengan kata kueri (awalan kata, tanpa peka huruf besar/kecil &
 * aksen) untuk disorot. Dicocokkan per karakter asli agar posisi tidak bergeser oleh huruf beraksen.
 */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const words = [...new Set(fold(query).match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length >= 2);
  if (!words.length || !text) return [{ text, match: false }];
  const chars = [...text];
  const folded = chars.map((c) => fold(c));
  const marked = new Array<boolean>(chars.length).fill(false);
  for (let i = 0; i < chars.length; i++) {
    if (i > 0 && /[\p{L}\p{N}]/u.test(folded[i - 1] ?? "")) continue; // hanya di awal kata
    for (const word of words) {
      let j = i;
      let k = 0;
      while (j < chars.length && k < word.length && word.startsWith(folded[j] ?? "", k) && folded[j]) {
        k += (folded[j] ?? "").length;
        j++;
      }
      if (k >= word.length) for (let m = i; m < j; m++) marked[m] = true;
    }
  }
  const parts: { text: string; match: boolean }[] = [];
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1];
    if (last && last.match === marked[i]) last.text += c;
    else parts.push({ text: c, match: !!marked[i] });
  });
  return parts;
}
