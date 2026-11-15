import { KeyRound, Lock, LockOpen, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useLockPin, usePinStatus, useRemovePin, useSetPin } from "@/data/use-pin";
import { errorMessage } from "@/lib/api/client";
import { pinProblem } from "./pin-logic";
import { requestUnlock } from "./pin-prompt";

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);

/** Profil Saya → PIN Keamanan: atur/ganti PIN, kunci sekarang, hapus PIN. */
export function PinSettingsCard() {
  const { data: status, isLoading } = usePinStatus();
  const setPin = useSetPin();
  const lock = useLockPin();
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [removing, setRemoving] = useState(false);
  const problem = pin ? pinProblem(pin, confirm) : null;

  const save = async () => {
    if (problem) return;
    try {
      await setPin.mutateAsync({ password, pin });
      toast.success(status?.hasPin ? "PIN diganti" : "PIN keamanan aktif", {
        description: "Sesi ini terbuka. Sesi lain perlu memasukkan PIN baru.",
      });
      setPinValue("");
      setConfirm("");
      setPassword("");
    } catch (error) {
      toast.error("PIN gagal disimpan", { description: errorMessage(error) });
    }
  };

  return (
    <div id="pin" className="scroll-mt-16">
      <SectionCard
        icon={ShieldCheck}
        title="PIN Keamanan"
        description="Kunci Area, Project, Resource, Catatan, List, dan Notebook yang bersifat pribadi."
        action={
          status?.hasPin ? (
            <Badge className={status.unlocked ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}>
              {status.unlocked ? <LockOpen /> : <Lock />} {status.unlocked ? "Terbuka di sesi ini" : "Terkunci"}
            </Badge>
          ) : undefined
        }
      >
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-4">
            <details className="rounded-xl border bg-muted/40 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Cara kerja kunci PIN</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>
                  Item terkunci tetap tampil dengan <b>judulnya saja</b>; isi, lampiran, dan rinciannya baru terbuka
                  setelah PIN dimasukkan. Mengunci Area/Project ikut mengunci isinya (Sub Area, Kegiatan, Action/Task,
                  Agenda).
                </li>
                <li>
                  Satu kali PIN membuka semua item terkunci <b>sampai logout</b>, atau sampai Anda menekan{" "}
                  <b>Kunci sekarang</b> (ikon gembok di header).
                </li>
                <li>
                  Item terkunci tetap masuk indeks pencarian. Pencarian menemukan judulnya; chatbot dan My Notebook
                  memakai isinya hanya saat PIN terbuka. Agen Hermes, bot WhatsApp, dan cermin Obsidian tidak pernah
                  membacanya.
                </li>
                <li>
                  PIN adalah kunci akses aplikasi, bukan enkripsi: data tetap tersimpan di server (agar bisa dicari) dan
                  ikut backup.
                </li>
              </ul>
            </details>

            {status?.hasPin && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {status.lockedItems ? `${status.lockedItems} item dikunci langsung.` : "Belum ada item yang dikunci."}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {status.unlocked ? (
                    <Button variant="outline" size="sm" disabled={lock.isPending} onClick={() => lock.mutate()}>
                      <Lock /> Kunci sekarang
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void requestUnlock()}>
                      <LockOpen /> Buka dengan PIN
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(true)}>
                    <Trash2 /> Hapus PIN
                  </Button>
                </span>
              </div>
            )}

            <form
              className="rounded-xl border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <FieldGroup className="gap-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="size-4 text-module" /> {status?.hasPin ? "Ganti PIN" : "Atur PIN"}
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="pin-new">PIN baru (6 angka)</FieldLabel>
                    <Input
                      id="pin-new"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPinValue(digitsOnly(e.target.value))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pin-confirm">Ulangi PIN</FieldLabel>
                    <Input
                      id="pin-confirm"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={confirm}
                      onChange={(e) => setConfirm(digitsOnly(e.target.value))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pin-password">Kata sandi akun</FieldLabel>
                    <Input
                      id="pin-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </div>
                <FieldDescription>
                  {problem ??
                    "Lupa PIN? Atur PIN baru di sini dengan kata sandi akun. Sesi lain akan terkunci dan perlu PIN baru."}
                </FieldDescription>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!pin || !!problem || !password || setPin.isPending}>
                    {setPin.isPending ? <Spinner /> : <ShieldCheck />} {status?.hasPin ? "Ganti PIN" : "Aktifkan PIN"}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </div>
        )}
      </SectionCard>
      <RemovePinDialog open={removing} onOpenChange={setRemoving} />
    </div>
  );
}

function RemovePinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const remove = useRemovePin();
  const [password, setPassword] = useState("");
  const submit = async () => {
    try {
      await remove.mutateAsync(password);
      toast.success("PIN keamanan dihapus");
      setPassword("");
      onOpenChange(false);
    } catch (error) {
      toast.error("PIN gagal dihapus", { description: errorMessage(error) });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Hapus PIN keamanan?</DialogTitle>
            <DialogDescription>
              Hanya bisa bila tidak ada item yang masih terkunci. Lepas kunci item lebih dulu.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="pin-remove-password">Kata sandi akun</FieldLabel>
            <Input
              id="pin-remove-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={!password || remove.isPending}>
              {remove.isPending ? <Spinner /> : <Trash2 />} Hapus PIN
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
