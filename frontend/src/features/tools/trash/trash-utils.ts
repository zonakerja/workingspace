import type { TrashItemInfo } from "@/types/api";

/** Logika murni halaman Sampah (diuji di `trash-utils.test.ts`). */

const RECORD_LABELS: Record<string, string> = {
  agenda_type: "Tipe agenda",
  routine: "Rutinitas",
  schedule: "Agenda",
  todo: "To-do",
  free_note: "Catatan Bebas",
  ai_note: "Notes AI",
  list: "List",
  para_project: "Project",
  para_area: "Area",
  para_task: "Action/Task",
  para_activity: "Kegiatan Area",
  para_resource: "Resource",
  para_archive: "Arsip PARA",
  skp: "SKP",
  skp_target: "RHK",
  action_plan_entry: "Rencana aksi",
  action_plan_month: "Bulan rencana aksi",
  srikandi_letter: "Naskah SRIKANDI",
  srikandi_reference: "Referensi SRIKANDI",
  srikandi_outgoing: "Register naskah keluar",
  archive_classification: "Klasifikasi arsip",
  archive_jra: "JRA",
  archive_physical_reference: "Lokasi arsip fisik",
  archive_borrowing: "Peminjaman arsip",
  archive_disposition: "Berita acara penyusutan",
};

const KIND_LABELS: Record<string, string> = {
  asset: "Berkas",
  request: "Pengajuan",
  notebook: "Notebook",
  vault_note: "Catatan vault",
};

export function itemLabel(item: Pick<TrashItemInfo, "kind" | "recordType">) {
  if (item.kind === "record") return RECORD_LABELS[item.recordType ?? ""] ?? item.recordType ?? "Data";
  return KIND_LABELS[item.kind] ?? item.kind;
}

export interface TrashGroup {
  batchId: string;
  deletedAt: string;
  expiresAt: string;
  source: "user" | "agent";
  items: TrashItemInfo[];
}

/** Item yang dihapus bersamaan (satu tindakan) dikelompokkan; kelompok terbaru dulu, item utama (bukan berkas) dulu. */
export function groupTrash(items: TrashItemInfo[]): TrashGroup[] {
  const groups = new Map<string, TrashGroup>();
  for (const item of items) {
    const group = groups.get(item.batchId);
    if (group) {
      group.items.push(item);
      if (item.deletedAt < group.deletedAt) group.deletedAt = item.deletedAt;
      if (item.expiresAt < group.expiresAt) group.expiresAt = item.expiresAt;
    } else {
      groups.set(item.batchId, {
        batchId: item.batchId,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
        source: item.source,
        items: [item],
      });
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => Number(a.kind === "asset") - Number(b.kind === "asset")) }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Sisa hari sebelum dihapus permanen (dibulatkan ke atas, minimal 0). */
export function daysLeft(expiresAt: string, now: Date) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000));
}

/** Saring per kata pada judul & jenis. */
export function filterTrash(items: TrashItemInfo[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = `${item.title} ${itemLabel(item)}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
