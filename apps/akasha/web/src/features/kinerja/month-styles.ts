import type { ActionPlanMonth } from "@/types/entities";

/** Warna badge keadaan bulan e-Kinerja (dipakai tab Rencana Aksi & Penilaian). */
export const MONTH_STYLE: Record<ActionPlanMonth["status"], string> = {
  empty: "bg-muted text-muted-foreground",
  unavailable: "bg-muted text-muted-foreground",
  draft: "bg-info/15 text-info",
  submitted: "bg-warning/15 text-warning",
  rated: "bg-success/15 text-success",
};
