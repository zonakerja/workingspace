import { itemLabel } from "@/features/tools/trash/trash-utils";
import type { AgentActionInfo } from "@/types/api";

/** Logika murni riwayat aksi agen (diuji di `action-utils.test.ts`). */

export const ACTION_KIND_LABELS: Record<AgentActionInfo["kind"], string> = {
  create: "Membuat",
  update: "Mengubah",
  delete: "Minta hapus",
};

export const ACTION_STATUS_LABELS: Record<AgentActionInfo["status"], string> = {
  applied: "Diterapkan",
  undone: "Dibatalkan",
  pending: "Menunggu persetujuan",
  approved: "Disetujui · di Sampah",
  rejected: "Ditolak",
  failed: "Gagal",
};

export const ACTION_STATUS_TONE: Record<AgentActionInfo["status"], string> = {
  applied: "bg-success/15 text-success",
  undone: "bg-muted text-muted-foreground",
  pending: "bg-warning/15 text-warning",
  approved: "bg-info/15 text-info",
  rejected: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

export const recordLabel = (recordType: string) => itemLabel({ kind: "record", recordType });

/** Kolom sistem yang tidak ditampilkan sebagai perubahan. */
const SYSTEM_KEYS = new Set(["id", "userId", "share"]);

const show = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/** Perubahan per field (sebelum → sesudah) untuk ditampilkan; aksi "buat" menampilkan isi yang diisi. */
export function actionChanges(action: Pick<AgentActionInfo, "kind" | "before" | "after">) {
  const before = action.before ?? {};
  const after = action.after ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((k) => !SYSTEM_KEYS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort()
    .map((key) => ({ key, from: action.kind === "create" ? null : show(before[key]), to: show(after[key]) }));
}

/** Turunan yang ikut terhapus, diringkas per jenis ("2 Action/Task, 1 Agenda"). */
export function childrenSummary(children: AgentActionInfo["children"]) {
  const counts = new Map<string, number>();
  for (const [type] of children ?? []) counts.set(recordLabel(type), (counts.get(recordLabel(type)) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
}
