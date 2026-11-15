import { KeyRound, Lock, LockOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
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
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLockPin, usePinStatus, useUnlockPin } from "@/data/use-pin";
import { errorMessage, setPinRequiredHandler } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { consumeLoginPinPrompt, type PinPromptMode, requestUnlock, settleUnlock, usePinPrompt } from "./pin-prompt";

/**
 * Dialog PIN global (dipasang di AppShell). Dibuka lewat `requestUnlock()` atau otomatis saat server menjawab
 * `PIN_REQUIRED` — permintaan yang tertahan diulang setelah PIN benar.
 */
export function PinUnlockHost() {
  const { open, reason, mode } = usePinPrompt();

  useEffect(() => {
    setPinRequiredHandler(() => requestUnlock());
    return () => setPinRequiredHandler(null);
  }, []);

  return (
    <>
      <LoginPinPrompt />
      <Dialog open={open} onOpenChange={(next) => !next && settleUnlock(false)}>
        <DialogContent className="sm:max-w-sm">{open && <PinUnlockForm reason={reason} mode={mode} />}</DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Tepat setelah login: bila akun punya PIN dan ada item terkunci, tawarkan "Masuk dengan PIN" atau "Lanjut tanpa PIN".
 * Tidak muncul saat halaman dimuat ulang (status terbuka sesi tetap tersimpan di server).
 */
function LoginPinPrompt() {
  const { data: status } = usePinStatus();
  useEffect(() => {
    // Penanda dari login dibaca sekali setelah status PIN termuat (aman untuk efek ganda StrictMode)
    if (!status || !consumeLoginPinPrompt()) return;
    if (!status.hasPin || status.unlocked || !status.lockedItems) return;
    void requestUnlock(`Akun Anda memiliki ${status.lockedItems} item terkunci.`, "login");
  }, [status]);
  return null;
}

function PinUnlockForm({ reason, mode }: { reason?: string; mode: PinPromptMode }) {
  const login = mode === "login";
  const navigate = useNavigate();
  const { data: status, isLoading } = usePinStatus();
  const unlock = useUnlockPin();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (value = pin) => {
    if (!/^\d{6}$/.test(value) || unlock.isPending) return;
    setError(null);
    try {
      await unlock.mutateAsync(value);
      settleUnlock(true);
    } catch (e) {
      setPin("");
      setError(errorMessage(e, "PIN salah."));
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (!status?.hasPin) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-warning" /> PIN belum diatur
          </DialogTitle>
          <DialogDescription>
            Item ini terkunci, tetapi akun Anda belum punya PIN keamanan. Atur PIN di Profil Saya untuk membukanya.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settleUnlock(false)}>
            Batal
          </Button>
          <Button
            onClick={() => {
              settleUnlock(false);
              void navigate("/profile#pin");
            }}
          >
            Atur PIN
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Lock className="size-5 text-module" /> {login ? "Masuk dengan PIN?" : "Masukkan PIN"}
        </DialogTitle>
        <DialogDescription>
          {login
            ? `${reason ?? "Ada item terkunci."} Masukkan PIN untuk membuka isinya selama sesi ini, atau lanjut tanpa PIN — item terkunci hanya menampilkan judul dan bisa dibuka nanti lewat ikon gembok.`
            : `${reason ?? "Item ini terkunci."} PIN membuka semua item terkunci sampai Anda logout atau menekan Kunci sekarang.`}
        </DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        aria-label="PIN 6 angka"
        placeholder="••••••"
        className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
        value={pin}
        disabled={unlock.isPending}
        onChange={(e) => {
          const value = e.target.value.replace(/\D/g, "").slice(0, 6);
          setPin(value);
          setError(null);
          if (value.length === 6) void submit(value);
        }}
      />
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => settleUnlock(false)}>
          {login ? "Lanjut tanpa PIN" : "Batal"}
        </Button>
        <Button type="submit" disabled={pin.length !== 6 || unlock.isPending}>
          {unlock.isPending ? <Spinner /> : <LockOpen />} {login ? "Masuk dengan PIN" : "Buka"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Tombol gembok di header: terbuka → Kunci sekarang; terkunci → masukkan PIN. Tampil bila PIN sudah diatur. */
export function PinLockButton() {
  const { data: status } = usePinStatus();
  const lock = useLockPin();
  if (!status?.hasPin) return null;
  const unlocked = status.unlocked;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unlocked ? "Kunci sekarang" : "Buka item terkunci"}
          className={cn(unlocked && "text-warning")}
          disabled={lock.isPending}
          onClick={() => (unlocked ? lock.mutate() : void requestUnlock())}
        >
          {unlocked ? <LockOpen /> : <Lock />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {unlocked
          ? "Item terkunci sedang terbuka — klik untuk mengunci sekarang"
          : "Item terkunci — klik untuk membuka dengan PIN"}
      </TooltipContent>
    </Tooltip>
  );
}
