import { KeyRound, Loader2, ScanSearch, Send, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePinStatus } from "@/data/use-pin";
import { errorMessage } from "@/lib/api/client";
import { robotApi } from "@/lib/api/endpoints";
import type { SrikandiOutgoing } from "@/types/entities";

/**
 * Kirim Konsep ke verifikator SRIKANDI. Tindakan resmi atas nama Anda, jadi setiap kali wajib PIN keamanan (bukan status
 * PIN sesi). "Periksa dulu" = robot membuka detail konsep di Log Naskah Keluar dan menandai tombol Kirim Konsep tanpa
 * mengklik. Agen tidak punya jalur ke tindakan ini.
 */
export function SendDraftDialog({
  entry,
  onClose,
  onDone,
  onShowRun,
}: {
  entry: SrikandiOutgoing | null;
  onClose: () => void;
  onDone: () => void;
  onShowRun: (runId: string) => void;
}) {
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid-cols-1 sm:max-w-lg">
        {entry && (
          <SendDraftForm key={entry.id} entry={entry} onClose={onClose} onDone={onDone} onShowRun={onShowRun} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendDraftForm({
  entry,
  onClose,
  onDone,
  onShowRun,
}: {
  entry: SrikandiOutgoing;
  onClose: () => void;
  onDone: () => void;
  onShowRun: (runId: string) => void;
}) {
  const navigate = useNavigate();
  const { data: pinStatus } = usePinStatus();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);

  const check = async () => {
    setBusy("check");
    setError(null);
    try {
      const r = await robotApi.sendOutgoing(entry.id, { dryRun: true });
      setChecked(r.runId);
      toast.success("Konsep ditemukan dan tombol Kirim Konsep siap — belum dikirim.", {
        action: { label: "Lihat", onClick: () => onShowRun(r.runId) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!/^\d{6}$/.test(pin) || busy) return;
    setBusy("send");
    setError(null);
    try {
      const r = await robotApi.sendOutgoing(entry.id, { dryRun: false, pin });
      toast.success("Konsep dikirim ke verifikator.", {
        duration: 12_000,
        action: { label: "Lihat", onClick: () => onShowRun(r.runId) },
      });
      onDone();
      onClose();
    } catch (e) {
      setPin("");
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const people = [
    entry.verifiers?.length ? `Verifikator: ${entry.verifiers.map((v) => v.label.split(" - ")[0]).join(", ")}` : "",
    entry.signer ? `Penandatangan: ${entry.signer.label.split(" - ")[0]}` : "",
  ].filter(Boolean);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Send className="size-5 text-module" /> Kirim Konsep ke verifikator?
        </DialogTitle>
        <DialogDescription>
          Robot membuka konsep ini di Log Naskah Keluar SRIKANDI lalu menekan <b>Kirim Konsep</b>. Naskah sampai ke
          verifikator atas nama Anda dan tidak bisa ditarik kembali dari LifeOS; sesudahnya konsep tidak bisa diubah
          lewat Edit.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
        <p className="font-medium break-words">{entry.subject || "(tanpa hal)"}</p>
        <p className="text-xs text-muted-foreground">
          {[entry.srikandiNumber || entry.number, entry.docType, ...people].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void check()}>
          {busy === "check" ? <Loader2 className="animate-spin" /> : <ScanSearch />} Periksa dulu (tanpa kirim)
        </Button>
        {checked && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onShowRun(checked)}>
            Lihat hasil periksa
          </Button>
        )}
      </div>

      {pinStatus && !pinStatus.hasPin ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="grid gap-2">
            <p>Kirim Konsep membutuhkan PIN keamanan. Atur PIN di Profil Saya lebih dulu.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                onClose();
                void navigate("/profile#pin");
              }}
            >
              Atur PIN
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor="send-draft-pin" className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldAlert className="size-4 text-warning" /> Masukkan PIN untuk mengirim
          </label>
          <Input
            id="send-draft-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="••••••"
            className="h-11 text-center font-mono text-xl tracking-[0.5em]"
            value={pin}
            disabled={!!busy}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            PIN diminta setiap kali mengirim, walau item terkunci sedang terbuka.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy === "send"} onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={pin.length !== 6 || !!busy || !pinStatus?.hasPin}>
          {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />} Kirim Konsep
        </Button>
      </DialogFooter>
    </form>
  );
}
