import { Bot, CalendarDays, CheckCircle2, ListChecks, Loader2, PencilLine, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import {
  useActionPlanEntries,
  useActivities,
  useAreas,
  useProjects,
  useProjectTasks,
  useResources,
  useSchedules,
  useSkpTargets,
} from "@/data/collections";
import { queryKeys } from "@/data/query-keys";
import { useAgentRunWatcher, useAgentStatus } from "@/data/use-agent";
import { useRenaksiScope } from "@/data/use-robot";
import { vaultUrl } from "@/features/vault/vault-utils";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api/client";
import { agentApi, vaultsApi } from "@/lib/api/endpoints";
import { formatShortDate, parseLocalYMD } from "@/lib/dates";
import type { ActionPlanEntry } from "@/types/entities";
import { ActionPlanDialog, type ActionPlanSource } from "./action-plan-dialog";
import { documentOptions, entryStatus, periodLabel } from "./lib/action-plan";
import {
  type CandidateFilter,
  candidateState,
  isExcluded,
  matchesFilter,
  orphanProposals,
  type RenaksiCandidate,
  renaksiCandidates,
} from "./lib/renaksi-candidates";
import { ScopeFilter } from "./scope-filter";

const SOURCE_LABELS = { task: "Action/Task", schedule: "Agenda", activity: "Kegiatan" } as const;
const FILTERS: { id: CandidateFilter; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "proposed", label: "Ada usulan" },
  { id: "accepted", label: "Masuk e-Kinerja" },
  { id: "open", label: "Belum diputuskan" },
];

/**
 * e-Kinerja → Rencana Aksi → "Kegiatan bulan ini": kegiatan yang ditarik dari Productivity (Productivity sendiri tidak
 * punya tombol e-Kinerja), disaring per Area / Project / Lepas (`ScopeFilter`). "Generate usulan" (agen) mengusulkan
 * RHK + Renaksi + Realisasi; Anda yang memutuskan lewat centang:
 * dicentang = masuk daftar RHK & diisikan robot, dilepas = keluar lagi. Usulan bisa diubah, diabaikan, atau ditambah
 * butir sendiri (satu RHK / satu kegiatan boleh beberapa butir).
 */
export function CandidatesSection({
  period,
  locked,
  onEdit,
  onRemoveEntry,
}: {
  period: string;
  locked: boolean;
  onEdit: (entry: ActionPlanEntry) => void;
  /** Hapus entri yang sudah masuk e-Kinerja (aturan papan: terkirim = ditandai hapus) */
  onRemoveEntry: (entry: ActionPlanEntry) => void;
}) {
  const { items: tasks } = useProjectTasks();
  const { items: schedules } = useSchedules();
  const { items: activities } = useActivities();
  const { items: projects } = useProjects();
  const { items: areas } = useAreas();
  const { excluded } = useRenaksiScope();
  const { items: resources } = useResources();
  const { items: entries, upsert, remove } = useActionPlanEntries();
  const { items: targets } = useSkpTargets();
  const { data: agent } = useAgentStatus();
  const client = useQueryClient();
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [adding, setAdding] = useState<ActionPlanSource | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unchecking, setUnchecking] = useState<ActionPlanEntry[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const allCandidates = renaksiCandidates(period, { tasks, schedules, activities, projects, areas });
  // Area / Project / kegiatan lepas yang dikecualikan tidak tampil (dan tidak ditawarkan ke agen — disaring juga di server)
  const candidates = allCandidates.filter((c) => !isExcluded(c, excluded));
  const hidden = allCandidates.length - candidates.length;
  const states = new Map(candidates.map((c) => [c.sourceId, candidateState(entries, period, c.sourceId)]));
  const visible = candidates.filter((c) => matchesFilter(states.get(c.sourceId)!, filter));
  // Pembanding = semua kegiatan (sebelum filter cakupan): usulan di Area/Project yang dikecualikan disembunyikan, bukan dianggap yatim
  const orphans = orphanProposals(entries, period, allCandidates);
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.id, candidates.filter((c) => matchesFilter(states.get(c.sourceId)!, f.id)).length]),
  ) as Record<CandidateFilter, number>;
  const targetName = (id?: string) => targets.find((t) => t.id === id)?.name;

  const hermesReady = !!agent?.configured && !!agent.owner && !!agent.reachable;
  const { run } = useAgentRunWatcher(runId, (r) => {
    void client.invalidateQueries({ queryKey: queryKeys.records("action_plan_entry") });
    if (r.status === "completed")
      toast.success("Usulan renaksi selesai disusun.", { description: r.output?.slice(0, 300) });
    else toast.error("Gagal menyusun usulan.", { description: r.error ?? undefined });
    setRunId(null);
  });
  const askHermes = async () => {
    setStarting(true);
    try {
      const r = await agentApi.renaksi(period);
      setRunId(r.runId);
      toast.info(`Menyusun usulan renaksi ${periodLabel(period)}…`, {
        description: "Usulan tampil di daftar ini setelah selesai. Anda yang memutuskan lewat centang.",
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  /** Bukti otomatis untuk satu kegiatan: berkas lampiran (dibuatkan brankas) atau web link-nya. */
  const evidenceOf = (candidate: RenaksiCandidate) => {
    const options = documentOptions(candidate.resources, resources);
    return {
      files: options.filter((o) => o.kind === "file" && o.uploadId).map((o) => o.uploadId!),
      link: options.find((o) => o.kind === "url")?.url,
    };
  };

  /** Usulan → entri (masuk e-Kinerja). Bukti bawaan = brankas dari lampiran berkas kegiatan, atau web link-nya. */
  const acceptProposals = async (candidate: RenaksiCandidate, proposals: ActionPlanEntry[]) => {
    const { files, link } = evidenceOf(candidate);
    for (const p of proposals) {
      let { documentUrl, vaultId } = p;
      if (!documentUrl && files.length) {
        const vault = await vaultsApi.create({
          title: `Renaksi ${periodLabel(period)} — ${p.description.slice(0, 200)}`,
          entryId: p.id,
          assetIds: files,
        });
        documentUrl = vaultUrl(vault.path!);
        vaultId = vault.id;
      } else if (!documentUrl && link) documentUrl = link;
      const next: ActionPlanEntry = { ...p, documentUrl, vaultId, proposed: false };
      next.status = entryStatus(
        { ...next, status: "draft" },
        targets.find((t) => t.id === p.targetId),
      );
      upsert(next);
    }
  };

  const accept = async (candidate: RenaksiCandidate, proposals: ActionPlanEntry[]) => {
    setBusy(candidate.sourceId);
    try {
      await acceptProposals(candidate, proposals);
      toast.success(`${proposals.length} butir masuk Rencana Aksi ${periodLabel(period)}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  // Centang semua usulan: hanya kegiatan yang tampil (filter cakupan berlaku), satu per satu agar brankas tidak bentrok
  const withProposals = candidates.filter((c) => states.get(c.sourceId)!.proposals.length > 0);
  const proposalCount = withProposals.reduce((n, c) => n + states.get(c.sourceId)!.proposals.length, 0);
  const withoutEvidence = withProposals.reduce((n, c) => {
    const { files, link } = evidenceOf(c);
    if (files.length || link) return n;
    return n + states.get(c.sourceId)!.proposals.filter((p) => !p.documentUrl).length;
  }, 0);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const acceptAll = async () => {
    setConfirmAll(false);
    const jobs = withProposals.map((c) => ({ c, proposals: states.get(c.sourceId)!.proposals }));
    setBulk({ done: 0, total: jobs.length });
    let accepted = 0;
    let failed = 0;
    for (const [i, job] of jobs.entries()) {
      try {
        await acceptProposals(job.c, job.proposals);
        accepted += job.proposals.length;
      } catch {
        failed += 1;
      }
      setBulk({ done: i + 1, total: jobs.length });
    }
    setBulk(null);
    if (failed) toast.error(`${accepted} butir masuk, ${failed} kegiatan gagal diproses — coba centang satu per satu.`);
    else
      toast.success(`${accepted} butir masuk Rencana Aksi ${periodLabel(period)}.`, {
        description: withoutEvidence
          ? `${withoutEvidence} butir belum punya bukti data dukung — lengkapi lewat Ubah di Isian e-Kinerja.`
          : "Periksa Isian e-Kinerja, lalu Kirim ke e-Kinerja.",
      });
  };

  /** Lepas centang: usulan Hermes kembali menjadi usulan, butir yang Anda tambahkan sendiri dihapus. */
  const release = (accepted: ActionPlanEntry[]) => {
    for (const e of accepted) {
      if (e.pushedSignature) onRemoveEntry(e);
      else if (e.proposedBy === "agent") upsert({ ...e, proposed: true });
      else {
        remove(e.id);
        if (e.vaultId) void vaultsApi.remove(e.vaultId).catch(() => undefined);
      }
    }
  };

  const toggle = (candidate: RenaksiCandidate, on: boolean) => {
    const state = states.get(candidate.sourceId)!;
    if (on) {
      if (state.proposals.length) void accept(candidate, state.proposals);
      else setAdding(sourceOf(candidate));
      return;
    }
    // Butir yang sudah terkirim ke e-Kinerja: konfirmasi dulu (dihapus dari e-Kinerja saat Kirim perubahan)
    if (state.accepted.some((e) => e.pushedSignature)) setUnchecking(state.accepted);
    else release(state.accepted);
  };

  // Usulan yang pernah dicentang lalu dilepas bisa sudah punya brankas: ikut dibuang agar tautan publiknya tidak tertinggal
  const ignore = (entry: ActionPlanEntry) => {
    remove(entry.id);
    if (entry.vaultId) void vaultsApi.remove(entry.vaultId).catch(() => undefined);
  };

  return (
    <section className="grid grid-cols-1 gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-4 text-module" />
        <p className="text-sm font-semibold">Kegiatan {periodLabel(period)}</p>
        <span className="text-xs text-muted-foreground">
          · {candidates.length}
          {hidden > 0 ? ` (${hidden} disembunyikan filter)` : ""}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <ScopeFilter candidates={allCandidates} />
          {proposalCount > 0 && (
            <Button size="sm" disabled={locked || !!bulk || !!busy} onClick={() => setConfirmAll(true)}>
              {bulk ? <Loader2 className="animate-spin" /> : <ListChecks />}
              {bulk ? `Memproses ${bulk.done}/${bulk.total}…` : `Centang semua usulan (${proposalCount})`}
            </Button>
          )}
          {hermesReady && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!!runId || starting || locked}
              onClick={() => void askHermes()}
            >
              {runId || starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {runId ? (run?.status === "queued" ? "Mengantre…" : "Menyusun usulan…") : "Generate usulan"}
            </Button>
          )}
        </span>
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="xs"
              variant={filter === f.id ? "secondary" : "ghost"}
              className={cn("rounded-full", filter === f.id && "text-module")}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground max-sm:w-full">
            Centang = masuk e-Kinerja. Yang tidak dicentang tidak diisikan robot.
          </span>
        </div>
      )}
      {candidates.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Tidak ada Action/Task, Agenda, atau Kegiatan di {periodLabel(period)}.
        </p>
      ) : visible.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">Tidak ada kegiatan pada saringan ini.</p>
      ) : (
        <ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
          {visible.map((c) => {
            const state = states.get(c.sourceId)!;
            const checked = state.accepted.length > 0;
            return (
              <li key={c.sourceId} className={cn("group px-3 py-2", checked && "bg-success/5")}>
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={locked || busy === c.sourceId}
                    aria-label={`Masukkan ${c.title} ke e-Kinerja`}
                    onCheckedChange={(v) => toggle(c, v === true)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{c.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                        {SOURCE_LABELS[c.sourceType]}
                      </Badge>
                      <span>{formatShortDate(parseLocalYMD(c.date))}</span>
                      <span>·</span>
                      <span className="min-w-0 break-words">
                        {c.scopeLabel}
                        {c.parentTitle && !c.scopeLabel.includes(c.parentTitle) ? ` · ${c.parentTitle}` : ""}
                      </span>
                      {c.done === false && <span className="text-warning">· belum selesai</span>}
                    </p>
                    {checked && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="size-3.5" /> {state.accepted.length} butir masuk e-Kinerja
                        {state.accepted
                          .map((e) => targetName(e.targetId))
                          .filter(Boolean)
                          .slice(0, 1)
                          .map((n) => ` · ${n}`)}
                      </p>
                    )}
                    {state.proposals.map((p) => (
                      <ProposalView
                        key={p.id}
                        entry={p}
                        target={targetName(p.targetId)}
                        disabled={locked}
                        onEdit={() => onEdit(p)}
                        onIgnore={() => ignore(p)}
                      />
                    ))}
                  </div>
                  {busy === c.sourceId ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
                      title="Tambah butir sendiri"
                      disabled={locked}
                      onClick={() => setAdding(sourceOf(c))}
                    >
                      <Plus />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {orphans.length > 0 && (
        <div className="grid grid-cols-1 gap-1 rounded-md border border-dashed p-2">
          <p className="text-xs text-muted-foreground">Usulan yang kegiatannya tidak lagi ada di bulan ini:</p>
          {orphans.map((p) => (
            <ProposalView
              key={p.id}
              entry={p}
              target={targetName(p.targetId)}
              disabled={locked}
              onEdit={() => onEdit(p)}
              onIgnore={() => ignore(p)}
            />
          ))}
        </div>
      )}

      <ActionPlanDialog open={!!adding} onClose={() => setAdding(null)} source={adding ?? undefined} />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Centang semua usulan ${periodLabel(period)}?`}
        description={`${proposalCount} usulan dari ${withProposals.length} kegiatan masuk Isian e-Kinerja dengan RHK, Renaksi, dan Realisasi seperti usulannya. Bukti data dukung dibuatkan otomatis dari lampiran kegiatan (brankas digital) bila ada${withoutEvidence ? `; ${withoutEvidence} butir tanpa lampiran perlu dilengkapi buktinya` : ""}. Belum ada yang dikirim ke e-Kinerja, dan setiap butir masih bisa dilepas atau diubah.`}
        confirmLabel="Centang semua"
        destructive={false}
        onConfirm={() => void acceptAll()}
      />
      <ConfirmDialog
        open={!!unchecking}
        onOpenChange={(open) => !open && setUnchecking(null)}
        title="Keluarkan dari e-Kinerja?"
        description="Sebagian butir kegiatan ini sudah terkirim ke e-Kinerja: ditandai Akan dihapus, lalu dihapus dari e-Kinerja saat Kirim perubahan. Kegiatan asal di Productivity tidak berubah."
        confirmLabel="Keluarkan"
        onConfirm={() => {
          if (unchecking) release(unchecking);
          setUnchecking(null);
        }}
      />
    </section>
  );
}

function sourceOf(c: RenaksiCandidate): ActionPlanSource {
  return {
    type: c.sourceType,
    id: c.sourceId,
    title: c.title,
    description: c.description,
    dates: [c.date],
    resources: c.resources,
  };
}

/** Satu usulan Hermes yang belum diputuskan. */
function ProposalView({
  entry,
  target,
  disabled,
  onEdit,
  onIgnore,
}: {
  entry: ActionPlanEntry;
  target?: string;
  disabled: boolean;
  onEdit: () => void;
  onIgnore: () => void;
}) {
  return (
    <div className="mt-1.5 rounded-md border border-info/30 bg-info/5 px-2.5 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className="bg-info/15 text-info">
          <Bot className="size-3" /> Usulan
        </Badge>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-xs" title="Ubah usulan" disabled={disabled} onClick={onEdit}>
          <PencilLine />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Abaikan usulan"
          className="hover:text-destructive"
          disabled={disabled}
          onClick={onIgnore}
        >
          <X />
        </Button>
      </div>
      <p className="mt-1 font-medium break-words">
        <span className="font-normal text-muted-foreground">RHK: </span>
        {target ?? <em className="text-warning">tidak ditemukan — ubah usulan</em>}
      </p>
      <p className="break-words whitespace-pre-line">
        <span className="text-muted-foreground">Renaksi: </span>
        {entry.description}
      </p>
      {entry.realization && (
        <p className="break-words whitespace-pre-line">
          <span className="text-muted-foreground">Realisasi: </span>
          {entry.realization}
        </p>
      )}
      {entry.proposalNote && <p className="mt-0.5 text-muted-foreground italic">{entry.proposalNote}</p>}
    </div>
  );
}
