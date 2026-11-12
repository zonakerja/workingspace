import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageLoader } from "@/components/common/page-loader";
import { PaginationControl } from "@/components/common/pagination-control";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { usePagination } from "@/hooks/use-pagination";
import { ApiError, errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AgentActionInfo } from "@/types/api";
import {
  ACTION_KIND_LABELS,
  ACTION_STATUS_LABELS,
  ACTION_STATUS_TONE,
  actionChanges,
  childrenSummary,
  recordLabel,
} from "./action-utils";

/**
 * AI Agent → Riwayat Aksi: semua yang dibuat/diubah agen di data kerja (bisa dibatalkan) dan permintaan hapusnya.
 * Batalkan ditolak bila data sudah Anda ubah lagi, kecuali Anda memilih tetap membatalkan.
 */
export function ActionHistoryTab() {
  const { data, isLoading } = useAgentActions();
  const m = useAgentActionMutations();
  const [conflict, setConflict] = useState<AgentActionInfo | null>(null);
  const { pageItems, controlProps } = usePagination(data ?? [], 15);

  const undo = (action: AgentActionInfo, force = false) =>
    m.undo.mutate(
      { id: action.id, force },
      {
        onSuccess: () =>
          toast.success(
            action.kind === "create" ? "Dibatalkan: data dipindah ke Sampah." : "Perubahan agen dibatalkan.",
          ),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409 && !force && action.status === "applied") setConflict(action);
          else toast.error(errorMessage(e));
        },
      },
    );

  if (isLoading) return <PageLoader />;
  return (
    <SectionCard
      icon={History}
      title="Riwayat aksi agen"
      description="Data yang dibuat atau diubah agen bisa dibatalkan. Agen tidak bisa menghapus: permintaannya menunggu persetujuan Anda di Approval → Usulan Agen."
      contentClassName="grid grid-cols-1 gap-2"
    >
      {!data?.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Agen belum mengubah data apa pun.</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2">
            {pageItems.map((action) => {
              const changes = action.kind === "delete" ? [] : actionChanges(action);
              return (
                <li key={action.id} className="min-w-0 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{ACTION_KIND_LABELS[action.kind]}</span>
                    <Badge variant="secondary">{recordLabel(action.recordType)}</Badge>
                    <span className="min-w-0 flex-1 truncate">{action.title}</span>
                    <Badge className={cn("shrink-0", ACTION_STATUS_TONE[action.status])}>
                      {ACTION_STATUS_LABELS[action.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(action.createdAt)}
                    {action.message && ` · ${action.message}`}
                  </p>
                  {changes.length > 0 && (
                    <ul className="mt-2 grid grid-cols-1 gap-0.5 text-xs">
                      {changes.slice(0, 8).map((c) => (
                        <li key={c.key} className="min-w-0 break-words">
                          <span className="font-medium">{c.key}</span>:{" "}
                          {c.from !== null && <span className="text-muted-foreground line-through">{c.from}</span>}
                          {c.from !== null && " → "}
                          <span>{c.to}</span>
                        </li>
                      ))}
                      {changes.length > 8 && (
                        <li className="text-muted-foreground">+{changes.length - 8} field lain</li>
                      )}
                    </ul>
                  )}
                  {action.kind === "delete" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {action.reason}
                      {action.children?.length ? ` · ikut: ${childrenSummary(action.children)}` : ""}
                    </p>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    {action.status === "applied" && (
                      <Button size="sm" variant="outline" disabled={m.undo.isPending} onClick={() => undo(action)}>
                        <RotateCcw /> Batalkan
                      </Button>
                    )}
                    {action.status === "pending" && (
                      <Button size="sm" variant="secondary" asChild>
                        <Link to="/requests/proposals">Putuskan di Approval</Link>
                      </Button>
                    )}
                    {action.status === "approved" && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/tools/trash">Buka Sampah</Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <PaginationControl {...controlProps} />
        </>
      )}
      <ConfirmDialog
        open={!!conflict}
        onOpenChange={(open) => !open && setConflict(null)}
        onConfirm={() => {
          if (conflict) undo(conflict, true);
          setConflict(null);
        }}
        title="Data sudah diubah lagi"
        description="Setelah agen mengubahnya, data ini sudah diubah lagi. Tetap membatalkan akan mengembalikan isi sebelum agen dan menimpa perubahan sesudahnya."
        itemName={conflict?.title}
        confirmLabel="Tetap batalkan"
      />
    </SectionCard>
  );
}
