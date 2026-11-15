import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  ThumbsUp,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useActionPlanEntries, useActionPlanMonths, useSkps, useSkpTargets } from "@/data/collections";
import { queryKeys } from "@/data/query-keys";
import { useToday } from "@/hooks/use-today";
import { errorMessage } from "@/lib/api/client";
import { robotApi } from "@/lib/api/endpoints";
import { formatDateTime, formatShortDate, parseLocalYMD } from "@/lib/dates";
import { RunDialog } from "@/features/tools/robot/robot-settings";
import type { ActionPlanEntry, ActionPlanMonth } from "@/types/entities";
import {
  assessmentCounts,
  assessmentMonths,
  displayStatus,
  hasFeedback,
  MONTH_STATUS_LABELS,
  periodLabel,
  skpPeriodLabel,
  submitBlocker,
} from "./lib/action-plan";
import { MONTH_STYLE } from "./month-styles";
import { SubmitAssessmentDialog } from "./submit-assessment-dialog";

/**
 * e-Kinerja → Penilaian: bulan yang renaksinya sudah ada di e-Kinerja (draf belum dikirim, sudah diajukan, sudah dinilai)
 * dipisah dari tab Rencana Aksi (tempat menyiapkan isian). Isi, tanggal pengajuan, rating, dan feedback atasan dibaca robot
 * lewat Pantau; bulan draf yang isiannya sudah sama dengan Akasha bisa di-Kirim Penilaian Ke Atasan (wajib PIN).
 */
export function AssessmentTab() {
  const today = useToday();
  const [year, setYear] = useState(() => today.getFullYear());
  const { items: months } = useActionPlanMonths();
  const { items: entries } = useActionPlanEntries();
  const { items: targets } = useSkpTargets();
  const { items: skps } = useSkps();
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState<ActionPlanMonth | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const client = useQueryClient();
  const refresh = () =>
    Promise.all(
      (["action_plan_entry", "action_plan_month"] as const).map((t) =>
        client.invalidateQueries({ queryKey: queryKeys.records(t) }),
      ),
    );

  const list = assessmentMonths(months, year);
  const counts = assessmentCounts(list);
  const lastRead = list
    .map((m) => m.syncedAt ?? "")
    .sort()
    .at(-1);
  // Isian Akasha bulan & SKP itu (tanpa usulan agen) → status gabungan untuk syarat Kirim Penilaian
  const entriesOf = (m: ActionPlanMonth) =>
    entries.filter(
      (e) =>
        e.period === m.period &&
        !e.proposed &&
        (e.skpId ?? targets.find((t) => t.id === e.targetId)?.skpId) === m.skpId,
    );
  const reasonOf = (m: ActionPlanMonth, own: ActionPlanEntry[]) =>
    submitBlocker(
      m,
      own.map((e) =>
        displayStatus(
          e,
          targets.find((t) => t.id === e.targetId),
          m,
        ),
      ),
    );

  const pantau = async () => {
    setSyncing(true);
    try {
      const r = await robotApi.syncRenaksi(year);
      await refresh();
      toast.success(`Penilaian ${year} dibaca dari e-Kinerja (${r.months.length} bulan).`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  const submittingEntries = submitting ? entriesOf(submitting) : [];

  return (
    <SectionCard
      icon={ClipboardCheck}
      title="Penilaian e-Kinerja"
      description="Renaksi yang sudah ada di e-Kinerja: draf yang belum dikirim, menunggu penilaian, dan yang sudah dinilai atasan."
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Tahun sebelumnya" onClick={() => setYear(year - 1)}>
            <ChevronLeft />
          </Button>
          <span className="w-12 text-center text-sm font-semibold tabular-nums">{year}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Tahun berikutnya" onClick={() => setYear(year + 1)}>
            <ChevronRight />
          </Button>
        </div>
        {(["draft", "submitted", "rated"] as const).map((s) =>
          counts[s] ? (
            <Badge key={s} className={MONTH_STYLE[s]}>
              {counts[s]} {s === "draft" ? "draf" : s === "submitted" ? "menunggu penilaian" : "dinilai"}
            </Badge>
          ) : null,
        )}
        <span className="ml-auto flex items-center gap-2">
          {lastRead && <span className="text-xs text-muted-foreground">Dibaca {formatDateTime(lastRead)}</span>}
          <Button size="sm" variant="outline" onClick={() => void pantau()} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Pantau
          </Button>
        </span>
      </div>

      {list.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>Belum ada renaksi di e-Kinerja tahun {year}</EmptyTitle>
            <EmptyDescription>
              Kirim isian dari tab Rencana Aksi, lalu klik <b>Pantau</b> untuk membaca keadaan bulan dari e-Kinerja.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {list.map((m) => {
            const own = entriesOf(m);
            return (
              <MonthItem
                key={m.id}
                month={m}
                skpLabel={(() => {
                  const skp = skps.find((s) => s.id === m.skpId);
                  return skp ? `SKP ${skpPeriodLabel(skp)}` : "";
                })()}
                showSkp={new Set(list.filter((x) => x.period === m.period).map((x) => x.skpId)).size > 1}
                entries={own.length}
                reason={m.status === "draft" ? reasonOf(m, own) : null}
                onSubmit={() => setSubmitting(m)}
              />
            );
          })}
        </ul>
      )}

      <SubmitAssessmentDialog
        period={submitting?.period ?? null}
        summary={{
          entries: submittingEntries.length,
          targets: new Set(submittingEntries.map((e) => e.targetId)).size,
        }}
        onClose={() => setSubmitting(null)}
        onDone={() => void refresh()}
        onShowRun={setRunId}
      />
      <RunDialog id={runId} onClose={() => setRunId(null)} />
    </SectionCard>
  );
}

function MonthItem({
  month,
  skpLabel,
  showSkp,
  entries,
  reason,
  onSubmit,
}: {
  month: ActionPlanMonth;
  skpLabel: string;
  showSkp: boolean;
  entries: number;
  reason: string | null;
  onSubmit: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rows = month.rows ?? [];
  const feedback = rows.filter((r) => hasFeedback(r.feedback)).length;
  const r = month.ratings;
  return (
    <li className="grid grid-cols-1 gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{periodLabel(month.period)}</p>
        <Badge className={MONTH_STYLE[month.status]}>{MONTH_STATUS_LABELS[month.status]}</Badge>
        {showSkp && skpLabel && <Badge variant="secondary">{skpLabel}</Badge>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {rows.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen((v) => !v)}>
              <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} />
              Isi ({rows.length} indikator)
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => void navigate(`/kinerja/plan?period=${month.period}`)}
          >
            <ExternalLink /> Rencana Aksi
          </Button>
          {month.status === "draft" && (
            <Button size="sm" className="h-7" onClick={onSubmit} disabled={!!reason} title={reason ?? undefined}>
              <UserCheck /> Kirim Penilaian
            </Button>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {month.status === "draft" && (
          <span className={reason ? "text-warning" : "text-success"}>
            {reason ?? `${entries} isian sama dengan e-Kinerja — siap dikirim ke atasan`}
          </span>
        )}
        {month.submittedAt && (
          <span>
            Diajukan {formatShortDate(parseLocalYMD(month.submittedAt))}
            {month.workday ? ` (hari kerja ke-${month.workday})` : ""}
          </span>
        )}
        {r?.predikat && (
          <span>
            Predikat <b className="text-foreground">{r.predikat}</b> · Hasil kerja {r.hasilKerja} · Perilaku{" "}
            {r.perilaku}
            {r.tunkin ? ` · Tunkin ${r.tunkin}%` : ""}
          </span>
        )}
        {month.status !== "draft" && rows.length > 0 && (
          <span className="flex items-center gap-1">
            <ThumbsUp className="size-3" /> Feedback {feedback}/{rows.length} indikator
          </span>
        )}
      </div>

      {open && (
        <ul className="grid grid-cols-1 gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <p className="font-medium">{row.text}</p>
              {(["renaksi", "realisasi", "bukti"] as const).map((kind) => (
                <p key={kind} className="mt-0.5 break-words">
                  <span className="text-muted-foreground">
                    {kind === "renaksi" ? "Renaksi" : kind === "realisasi" ? "Realisasi" : "Bukti"}:{" "}
                  </span>
                  {row[kind].length ? row[kind].join(" · ") : <em>belum diisi</em>}
                </p>
              ))}
              {row.feedback && <p className="mt-0.5 text-muted-foreground">Feedback: {row.feedback}</p>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
