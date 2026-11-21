import { randomBytes } from "node:crypto";

/**
 * Checklist kelengkapan pengajuan (`requests.analysis.checklist`) + tanda **cek manual** oleh pemilik. Butir yang diusulkan
 * AI agent untuk dicek manual (status "perlu_dicek" / `manual: true`) ditandai pemilik "Lolos" atau "Bermasalah" + catatan;
 * agen membaca tanda itu saat menelaah ulang sehingga butir yang sudah dicek tidak diusulkan lagi. Tanda dipertahankan saat
 * agen menulis ulang checklist (dicocokkan lewat `id`, lalu teks dokumen). Logika murni → `request-checklist.spec.ts`.
 */

export const CHECK_STATUSES = ["ada", "tidak_ada", "perlu_dicek"] as const;
export type ChecklistStatus = (typeof CHECK_STATUSES)[number];
export type ManualCheckResult = "lolos" | "bermasalah";

export interface ManualCheck {
  result: ManualCheckResult;
  note: string | null;
  at: string;
  by: "user";
}

export interface ChecklistItem {
  id: string;
  dokumen: string;
  status: ChecklistStatus;
  catatan: string;
  /** Diusulkan agen untuk diperiksa manual oleh pemilik (mis. keaslian fisik, hal yang tidak bisa dicek otomatis) */
  manual?: boolean;
  check?: ManualCheck;
}

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const newId = () => randomBytes(4).toString("hex");
const withoutCheck = (item: ChecklistItem): ChecklistItem => {
  const copy = { ...item };
  delete copy.check;
  return copy;
};

/** Checklist dari data apa pun (jawaban AI, agen, data lama) → butir sah dengan id; maks. 60 butir. */
export function normalizeChecklist(input: unknown): ChecklistItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const raw of input.slice(0, 60)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const dokumen = typeof r.dokumen === "string" ? r.dokumen.trim().slice(0, 1000) : "";
    if (!dokumen) continue;
    const status = CHECK_STATUSES.includes(r.status as ChecklistStatus) ? (r.status as ChecklistStatus) : "perlu_dicek";
    let id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    const item: ChecklistItem = {
      id,
      dokumen,
      status,
      catatan: typeof r.catatan === "string" ? r.catatan.trim().slice(0, 2000) : "",
    };
    if (r.manual === true) item.manual = true;
    const check = r.check as Partial<ManualCheck> | undefined;
    if (check && (check.result === "lolos" || check.result === "bermasalah") && typeof check.at === "string")
      item.check = {
        result: check.result,
        note: typeof check.note === "string" ? check.note : null,
        at: check.at,
        by: "user",
      };
    items.push(item);
  }
  return items;
}

/**
 * Checklist baru dari agen menggantikan yang lama, tetapi tanda cek manual pemilik tetap menempel: dicocokkan lewat `id`
 * yang dikirim ulang agen, lalu lewat teks dokumen yang sama. Tanda yang dikirim agen sendiri diabaikan (hanya pemilik).
 */
export function mergeChecklist(previous: unknown, next: unknown): ChecklistItem[] {
  const prev = normalizeChecklist(previous);
  const byId = new Map(prev.map((p) => [p.id, p]));
  const byText = new Map(prev.map((p) => [fold(p.dokumen), p]));
  return normalizeChecklist(next).map((item) => {
    const rest = withoutCheck(item);
    const match = byId.get(item.id) ?? byText.get(fold(item.dokumen));
    return match?.check ? { ...rest, id: match.id, check: match.check } : rest;
  });
}

/** Tandai / hapus tanda cek manual satu butir (null = batalkan tanda). */
export function applyManualCheck(
  checklist: unknown,
  itemId: string,
  result: ManualCheckResult | null,
  note: string | null,
  at: string,
): { items: ChecklistItem[]; item: ChecklistItem } | null {
  const items = normalizeChecklist(checklist);
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) return null;
  const rest = withoutCheck(items[index]);
  const item: ChecklistItem = result
    ? { ...rest, check: { result, note: note?.trim() || null, at, by: "user" } }
    : rest;
  items[index] = item;
  return { items, item };
}

/** Butir yang masih perlu tindakan pemilik: perlu dicek / diusulkan manual dan belum ditandai lolos. */
export function openManualChecks(checklist: unknown) {
  return normalizeChecklist(checklist).filter(
    (i) => (i.status === "perlu_dicek" || i.manual) && i.check?.result !== "lolos",
  );
}
