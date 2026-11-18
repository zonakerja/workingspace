import { Bot, Check, Send, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import type { AgentActionInfo } from "@/types/api";

interface EmailDraft {
  from?: string;
  to?: string[];
  subject?: string;
  body?: string;
}

/**
 * Permintaan agen mengirim email atas nama Anda (docs/AKUN-TERSAMBUNG.md tahap 3). Tidak ada yang terkirim sebelum disetujui di
 * sini; yang dikirim persis isi yang tampil. Tampil di Approval → Usulan Agen dan menu Email.
 */
export function SendEmailRequestsCard() {
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const [confirm, setConfirm] = useState<AgentActionInfo | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const pending = (data ?? []).filter((a) => a.kind === "send_email");
  if (!pending.length) return null;

  const approve = () => {
    if (!confirm) return;
    const action = confirm;
    setConfirm(null);
    setRunning(action.id);
    m.approve.mutate(action.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success("Email terkirim.", { description: r.message })
          : toast.error("Email gagal dikirim.", { description: r.message }),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => setRunning(null),
    });
  };

  return (
    <Card className="grid grid-cols-1 gap-3 border-warning/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Send className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Permintaan kirim email dari agen ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Baca isinya dulu. Email baru terkirim dari akun Anda setelah Anda klik Setujui & kirim.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => {
          const mail = (action.after ?? {}) as EmailDraft;
          const busy = running === action.id;
          return (
            <li key={action.id} className="min-w-0 rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{mail.subject}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(action.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs break-words text-muted-foreground">
                Dari {mail.from} · Ke {(mail.to ?? []).join(", ")}
              </p>
              {action.reason && (
                <p className="mt-2 flex gap-1.5 text-muted-foreground">
                  <Bot className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{action.reason}</span>
                </p>
              )}
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-muted/40 p-2 text-xs whitespace-pre-wrap break-words">
                {mail.body}
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={m.reject.isPending || busy}
                  onClick={() =>
                    m.reject.mutate(
                      { id: action.id },
                      {
                        onSuccess: () => toast.success("Permintaan kirim email ditolak."),
                        onError: (e) => toast.error(errorMessage(e)),
                      },
                    )
                  }
                >
                  <X /> Tolak
                </Button>
                <Button size="sm" disabled={!!running} onClick={() => setConfirm(action)}>
                  {busy ? <Spinner /> : <Check />} {busy ? "Mengirim…" : "Setujui & kirim"}
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
        title="Kirim email ini?"
        description={`Email dikirim dari ${(confirm?.after as EmailDraft | undefined)?.from ?? "akun email Anda"} ke ${((confirm?.after as EmailDraft | undefined)?.to ?? []).join(", ")}. Email yang sudah terkirim tidak bisa ditarik kembali.`}
        itemName={confirm?.title}
        confirmLabel="Ya, kirim"
      />
    </Card>
  );
}
