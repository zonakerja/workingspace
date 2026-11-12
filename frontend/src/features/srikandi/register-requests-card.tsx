import { useQueryClient } from "@tanstack/react-query";
import { Bot, Check, FilePlus2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { queryKeys } from "@/data/query-keys";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { links } from "@/lib/deep-links";
import type { AgentActionInfo } from "@/types/api";

interface RegisterSnapshot {
  entryId?: string;
  formType?: string;
  docType?: string;
  number?: string;
  file?: string | null;
  attachments?: string[];
  recipients?: string[];
  signer?: string | null;
}

/**
 * Permintaan agen agar robot mendaftarkan satu entri Register Naskah Keluar ke SRIKANDI. Tidak ada yang dikirim sebelum
 * disetujui di sini; setelah disetujui robot mengisi formulir Registrasi dari isi entri terkini (sama dengan tombol
 * "Daftarkan ke SRIKANDI") lalu berhenti di Simpan — Kirim Konsep tetap Anda lakukan di SRIKANDI. Tampil di Approval →
 * Usulan Agen dan di SRIKANDI → Register / Workflow.
 */
export function SrikandiRegisterRequestsCard() {
  const client = useQueryClient();
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const [confirm, setConfirm] = useState<AgentActionInfo | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const pending = (data ?? []).filter((a) => a.kind === "srikandi_register");
  if (!pending.length) return null;

  const approve = () => {
    if (!confirm) return;
    const action = confirm;
    setConfirm(null);
    setRunning(action.id);
    toast.info("Robot mulai mengisi formulir SRIKANDI…", {
      description: "Bisa beberapa menit. Jangan tutup halaman ini.",
    });
    m.approve.mutate(action.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success("Naskah didaftarkan sebagai konsep.", { description: r.message })
          : toast.error("Pendaftaran gagal.", { description: r.message }),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => {
        setRunning(null);
        void client.invalidateQueries({ queryKey: queryKeys.records("srikandi_outgoing") });
      },
    });
  };
  const reject = (action: AgentActionInfo) =>
    m.reject.mutate(
      { id: action.id },
      {
        onSuccess: () => toast.success("Permintaan pendaftaran ditolak."),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Card className="grid grid-cols-1 gap-3 border-info/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info">
          <FilePlus2 className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Permintaan daftarkan naskah ke SRIKANDI dari agen ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Robot hanya menyimpan konsep di Log Naskah Keluar setelah Anda setujui. Kirim Konsep & tanda tangan tetap
            oleh Anda di SRIKANDI.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => {
          const snap = (action.after ?? {}) as RegisterSnapshot;
          const busy = running === action.id;
          const facts = [
            snap.formType === "final" ? "Naskah Final" : "Naskah Keluar",
            snap.docType,
            snap.number,
            snap.signer && `TTD: ${snap.signer}`,
          ].filter(Boolean);
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
              <p className="mt-1 text-xs break-words text-muted-foreground">{facts.join(" · ")}</p>
              <p className="mt-0.5 text-xs break-words text-muted-foreground">
                {snap.file ? `Naskah: ${snap.file}` : "Tanpa file naskah"}
                {snap.attachments?.length ? ` · ${snap.attachments.length} lampiran` : ""}
                {snap.recipients?.length ? ` · Tujuan: ${snap.recipients.join(", ")}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Yang didaftarkan = isi entri terkini saat Anda menyetujui.
              </p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {snap.entryId && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={links.srikandiRegister(snap.entryId)}>Lihat entri</Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={m.reject.isPending || busy}
                  onClick={() => reject(action)}
                >
                  <X /> Tolak
                </Button>
                <Button size="sm" disabled={!!running} onClick={() => setConfirm(action)}>
                  {busy ? <Spinner /> : <Check />} {busy ? "Robot mendaftarkan…" : "Setujui & daftarkan"}
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
        title="Daftarkan naskah ke SRIKANDI?"
        description="Robot membuka SRIKANDI dengan sesi tersimpan, mengisi formulir Registrasi dari entri Register terkini, lalu menekan Simpan sehingga konsep masuk Log Naskah Keluar. Draf berhal sama tidak dibuat ulang. Kirim Konsep tidak dilakukan robot."
        itemName={confirm?.title}
        confirmLabel="Ya, daftarkan"
      />
    </Card>
  );
}
