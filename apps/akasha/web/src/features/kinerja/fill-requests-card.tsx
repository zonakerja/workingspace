import { Bot, Check, ClipboardCheck, X } from "lucide-react";
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

interface FillSnapshot {
  total?: number;
  deleted?: number;
  entries?: { description: string; deleted?: boolean }[];
}

/**
 * Permintaan agen agar robot mengisi Rencana Aksi satu bulan ke e-Kinerja. Tidak ada yang diisi sebelum disetujui di
 * sini; setelah disetujui robot mengisi draf dari isi terkini (sama dengan tombol Kirim di papan Rencana Aksi) dan
 * tidak pernah mengirim penilaian ke atasan. Tampil di Approval → Usulan Agen dan di e-Kinerja → Rencana Aksi.
 */
export function EkinerjaFillRequestsCard() {
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const [confirm, setConfirm] = useState<AgentActionInfo | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const pending = (data ?? []).filter((a) => a.kind === "ekinerja_fill");
  if (!pending.length) return null;

  const approve = () => {
    if (!confirm) return;
    const action = confirm;
    setConfirm(null);
    setRunning(action.id);
    toast.info("Robot mulai mengisi e-Kinerja…", { description: "Bisa beberapa menit. Jangan tutup halaman ini." });
    m.approve.mutate(action.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success(`${action.title} selesai.`, { description: r.message })
          : toast.error("Pengisian gagal.", { description: r.message }),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => setRunning(null),
    });
  };
  const reject = (action: AgentActionInfo) =>
    m.reject.mutate(
      { id: action.id },
      {
        onSuccess: () => toast.success("Permintaan pengisian ditolak."),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Card className="grid grid-cols-1 gap-3 border-info/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-info/15 text-info">
          <ClipboardCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Permintaan isi e-Kinerja dari agen ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Robot hanya mengisi setelah Anda setujui, berupa draf. Penilaian tidak pernah dikirim ke atasan oleh robot.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => {
          const snap = (action.after ?? {}) as FillSnapshot;
          const entries = snap.entries ?? [];
          const busy = running === action.id;
          return (
            <li key={action.id} className="min-w-0 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{action.title}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(action.createdAt)}</span>
              </div>
              {action.reason && (
                <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground">
                  <Bot className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{action.reason}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {snap.total ?? 0} entri saat diminta
                {snap.deleted ? ` · ${snap.deleted} akan dihapus dari e-Kinerja` : ""}. Yang diisikan = isi terkini saat
                Anda menyetujui.
              </p>
              {entries.length > 0 && (
                <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs">
                  {entries.slice(0, 5).map((e, i) => (
                    <li key={i} className={e.deleted ? "truncate text-muted-foreground line-through" : "truncate"}>
                      • {e.description}
                    </li>
                  ))}
                  {entries.length > 5 && <li className="text-muted-foreground">+{entries.length - 5} entri lain</li>}
                </ul>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={m.reject.isPending || busy}
                  onClick={() => reject(action)}
                >
                  <X /> Tolak
                </Button>
                <Button size="sm" disabled={!!running} onClick={() => setConfirm(action)}>
                  {busy ? <Spinner /> : <Check />} {busy ? "Robot mengisi…" : "Setujui & isi"}
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
        title="Isi Rencana Aksi ke e-Kinerja?"
        description="Robot membuka e-Kinerja dengan sesi tersimpan lalu mengisi draf bulan ini dari entri Akasha terkini (baris yang berubah ditulis ulang). Bulan yang sudah diajukan tidak diisi, dan penilaian tidak dikirim ke atasan."
        itemName={confirm?.title}
        confirmLabel="Ya, isi sekarang"
      />
    </Card>
  );
}
