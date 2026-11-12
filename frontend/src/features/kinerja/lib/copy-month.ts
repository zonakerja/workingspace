import type { ActionPlanEntry, Skp, SkpTarget } from "@/types/entities";
import { normalizeText, shiftPeriod, skpsForPeriod, targetOptions, targetsForSkp } from "./action-plan";

/**
 * Salin butir rutin dari bulan lalu (logika murni, diuji di `copy-month.test.ts`). Butir rencana aksi yang berulang tiap
 * bulan (rapat rutin, laporan bulanan) tidak perlu diketik ulang: Renaksi, Realisasi, RHK & indikator disalin ke bulan
 * ini. **Bukti data dukung tidak disalin** (bukti tiap bulan harus dokumen bulan itu), jadi salinan berstatus "belum
 * lengkap" sampai buktinya diisi. RHK dipetakan ke SKP bulan ini: ID sama, atau nama RHK sama bila SKP berganti.
 */

export interface CopyCandidate {
  /** Entri bulan lalu */
  entry: ActionPlanEntry;
  /** RHK di bulan ini (kosong = tidak ditemukan, perlu dipilih setelah disalin) */
  targetId?: string;
  targetName?: string;
  skpId?: string;
  /** Indikator yang masih ada di RHK bulan ini */
  indicators?: string[];
  /** Butir yang sama (RHK + renaksi) sudah ada di bulan ini */
  exists: boolean;
}

/** RHK bulan ini: SKP tunggal bulan itu, semua SKP bila dipecah di tengah bulan, atau RHK manual tahun itu. */
function monthTargets(skps: Skp[], targets: SkpTarget[], period: string) {
  const plan = targetOptions(skps, targets, period);
  if (plan.skp || !plan.candidates.length) return plan.targets;
  return skpsForPeriod(skps, period).flatMap((s) => targetsForSkp(targets, s.id));
}

export function copyCandidates(
  entries: ActionPlanEntry[],
  targets: SkpTarget[],
  skps: Skp[],
  period: string,
): CopyCandidate[] {
  const previous = shiftPeriod(period, -1);
  const current = entries.filter((e) => e.period === period && !e.deleted && !e.proposed);
  const available = monthTargets(skps, targets, period);
  return entries
    .filter((e) => e.period === previous && !e.deleted && !e.proposed && e.description.trim())
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map((entry) => {
      const old = targets.find((t) => t.id === entry.targetId);
      const target =
        available.find((t) => t.id === entry.targetId) ??
        (old
          ? available.find(
              (t) => normalizeText(t.name) === normalizeText(old.name) && (t.section ?? "") === (old.section ?? ""),
            )
          : undefined);
      const names = new Set((target?.indicators ?? []).map((i) => i.indicator));
      const indicators = entry.indicators?.filter((i) => names.has(i));
      return {
        entry,
        targetId: target?.id,
        targetName: target?.name,
        skpId: target?.skpId,
        // Semua / tidak ada yang cocok = kosong (berarti semua indikator RHK)
        indicators: indicators?.length ? indicators : undefined,
        exists: current.some(
          (c) =>
            c.targetId === (target?.id ?? entry.targetId) &&
            normalizeText(c.description) === normalizeText(entry.description),
        ),
      };
    });
}

/** Entri baru bulan ini dari satu butir bulan lalu (tanpa bukti, tanpa riwayat kirim). */
export function copiedEntry(candidate: CopyCandidate, period: string, id: string, now: string): ActionPlanEntry {
  const { entry } = candidate;
  return {
    id,
    period,
    skpId: candidate.skpId,
    targetId: candidate.targetId,
    description: entry.description,
    realization: entry.realization,
    timeRealization: entry.timeRealization,
    indicators: candidate.indicators,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceTitle: entry.sourceTitle,
    status: "draft",
    createdAt: now,
  };
}
