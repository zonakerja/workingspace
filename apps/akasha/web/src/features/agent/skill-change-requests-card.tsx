import { Bot, Check, FileCode2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { lineDiff } from "@/features/knowledge/workspace/line-diff";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AgentActionInfo } from "@/types/api";

/**
 * Usulan perubahan skill dari AI agent (folder skill baca saja bagi agen). Pemilik membaca alasan & perubahan baris, lalu
 * Setujui = server menulis SKILL.md (skill dipakai mulai tugas berikutnya) atau Tolak. Tampil di Approval → Usulan Agen.
 */
export function SkillChangeRequestsCard() {
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const [confirm, setConfirm] = useState<AgentActionInfo | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const pending = (data ?? []).filter((a) => a.kind === "skill_change");
  if (!pending.length) return null;

  const approve = () => {
    if (!confirm) return;
    const action = confirm;
    setConfirm(null);
    setRunning(action.id);
    m.approve.mutate(action.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success("Skill diperbarui.", { description: r.message })
          : toast.error("Skill gagal ditulis.", { description: r.message }),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => setRunning(null),
    });
  };

  return (
    <Card className="grid grid-cols-1 gap-3 border-info/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info">
          <FileCode2 className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Usulan perubahan skill dari AI agent ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Baca alasan & perubahannya. Setujui = SKILL.md ditulis dan dipakai AI agent mulai tugas berikutnya.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => (
          <SkillChangeItem
            key={action.id}
            action={action}
            busy={running === action.id || m.reject.isPending}
            onApprove={() => setConfirm(action)}
            onReject={() =>
              m.reject.mutate(
                { id: action.id },
                {
                  onSuccess: () => toast.success("Usulan skill ditolak."),
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          />
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Setujui perubahan skill?"
        description={`${confirm?.title ?? ""}. Berkas SKILL.md ditulis sekarang dan dipakai AI agent mulai tugas berikutnya.`}
        confirmLabel="Setujui & tulis"
        destructive={false}
        onConfirm={approve}
      />
    </Card>
  );
}

function SkillChangeItem({
  action,
  busy,
  onApprove,
  onReject,
}: {
  action: AgentActionInfo;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const after = ((action.after ?? {}) as { content?: string }).content ?? "";
  const before = ((action.before ?? null) as { content?: string } | null)?.content ?? null;
  const [full, setFull] = useState(false);
  const diff = before === null ? null : lineDiff(before.replace(/\r\n/g, "\n"), after);
  return (
    <li className="min-w-0 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{action.title}</span>
        <span className="text-xs text-muted-foreground">{formatDateTime(action.createdAt)}</span>
      </div>
      {action.reason && (
        <p className="mt-2 flex gap-1.5 text-muted-foreground">
          <Bot className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{action.reason}</span>
        </p>
      )}
      <div className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
        {before === null || full || !diff ? (
          <pre className="whitespace-pre-wrap break-words">{after}</pre>
        ) : (
          diff.map((line, i) =>
            line.type === "skip" ? (
              <div key={i} className="text-muted-foreground">
                … {line.count} baris sama …
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-words",
                  line.type === "add" && "bg-success/15 text-success",
                  line.type === "del" && "bg-destructive/15 text-destructive line-through",
                )}
              >
                {line.type === "add" ? "+ " : line.type === "del" ? "− " : "  "}
                {line.text || " "}
              </div>
            ),
          )
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {before !== null && (
          <Button size="sm" variant="ghost" className="mr-auto" onClick={() => setFull((v) => !v)}>
            {full ? "Lihat perubahan" : "Lihat isi lengkap"}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
          <X /> Tolak
        </Button>
        <Button size="sm" disabled={busy} onClick={onApprove}>
          {busy ? <Spinner /> : <Check />} Setujui & tulis
        </Button>
      </div>
    </li>
  );
}
