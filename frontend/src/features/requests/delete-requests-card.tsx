import { Bot, Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { childrenSummary, recordLabel } from "@/features/agent/action-utils";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import type { AgentActionInfo } from "@/types/api";

/**
 * Approval → Usulan Agen: permintaan hapus dari agen. Agen tidak bisa menghapus sendiri; yang disetujui di sini
 * masuk Sampah bersama turunannya dan bisa dipulihkan 30 hari dari Tools → Sampah.
 */
export function DeleteRequestsCard() {
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const [confirm, setConfirm] = useState<AgentActionInfo | null>(null);
  const pending = (data ?? []).filter((a) => a.kind === "delete");
  if (!pending.length) return null;

  const approve = () => {
    if (!confirm) return;
    m.approve.mutate(confirm.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success(`${r.removed} item${r.files ? ` dan ${r.files} berkas` : ""} dipindah ke Sampah.`, {
              description: "Bisa dipulihkan dari Tools → Sampah.",
            })
          : toast.error("Data sudah tidak ada."),
      onError: (e) => toast.error(errorMessage(e)),
    });
    setConfirm(null);
  };
  const reject = (action: AgentActionInfo) =>
    m.reject.mutate(
      { id: action.id },
      {
        onSuccess: () => toast.success("Permintaan hapus ditolak."),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Card className="grid grid-cols-1 gap-3 border-warning/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Permintaan hapus dari agen ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Tidak ada yang terhapus sebelum Anda setujui. Yang disetujui masuk Sampah dan bisa dipulihkan 30 hari.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => {
          const children = childrenSummary(action.children);
          return (
            <li key={action.id} className="min-w-0 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{recordLabel(action.recordType)}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium">{action.title}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(action.createdAt)}</span>
              </div>
              {action.reason && (
                <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground">
                  <Bot className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{action.reason}</span>
                </p>
              )}
              {children && <p className="mt-1 text-xs text-warning">Ikut terhapus: {children}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="outline" disabled={m.reject.isPending} onClick={() => reject(action)}>
                  <X /> Tolak
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirm(action)}>
                  <Check /> Setujui hapus
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        onConfirm={approve}
        title="Setujui penghapusan?"
        description={`Item${confirm?.children?.length ? " dan turunannya" : ""} dipindah ke Sampah dan bisa dipulihkan selama 30 hari.`}
        itemName={
          confirm
            ? `${recordLabel(confirm.recordType)}: ${confirm.title}${confirm.children?.length ? ` (+ ${childrenSummary(confirm.children)})` : ""}`
            : undefined
        }
        confirmLabel="Ya, pindahkan ke Sampah"
      />
    </Card>
  );
}
