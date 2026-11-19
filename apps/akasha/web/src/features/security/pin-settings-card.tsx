import { ExternalLink, KeyRound, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLockPin, usePinStatus, useSetPinAutoLock } from "@/data/use-pin";
import { errorMessage } from "@/lib/api/client";
import { toast } from "sonner";
import { requestUnlock } from "./pin-prompt";

const AUTO_LOCK_OPTIONS = [
  { value: "never", label: "Sampai logout" },
  { value: "5", label: "Setelah 5 menit" },
  { value: "15", label: "Setelah 15 menit" },
  { value: "30", label: "Setelah 30 menit" },
  { value: "60", label: "Setelah 1 jam" },
  { value: "240", label: "Setelah 4 jam" },
];

/** Profil Saya → PIN Keamanan: status, kunci sekarang / buka; PIN sendiri diatur di akun Workingspace (SSO). */
export function PinSettingsCard() {
  const { data: status, isLoading } = usePinStatus();
  const lock = useLockPin();
  const autoLock = useSetPinAutoLock();

  return (
    <div id="pin" className="scroll-mt-16">
      <SectionCard
        icon={ShieldCheck}
        title="PIN Keamanan"
        description="Kunci Area, Sub Area/Kegiatan, Project, Resource, Catatan, List, dan Notebook yang bersifat pribadi."
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
                  Satu kali PIN membuka semua item terkunci <b>sampai logout</b>, sampai Anda menekan{" "}
                  <b>Kunci sekarang</b> (ikon gembok di header), atau sampai <b>kunci otomatis</b> bila diatur di bawah.
                  Sub Area, Kegiatan, dan Sub Kegiatan juga bisa dikunci sendiri lewat ikon gembok di dialog Area.
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
                </span>
              </div>
            )}

            {status?.hasPin && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <b>Kunci otomatis</b>
                  <span className="block text-xs text-muted-foreground">
                    PIN dikunci lagi bila tidak ada aktivitas atas item terkunci selama waktu ini (berlaku di semua
                    perangkat).
                  </span>
                </span>
                <Select
                  value={String(status.autoLockMinutes ?? "never")}
                  disabled={autoLock.isPending}
                  onValueChange={(value) =>
                    autoLock.mutate(value === "never" ? null : Number(value), {
                      onSuccess: () => toast.success("Kunci otomatis disimpan."),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_LOCK_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {status?.managedBySso ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
                <KeyRound className="size-4 shrink-0 text-module" />
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {status.hasPin ? "PIN Anda" : "PIN"} diatur di <b>akun Workingspace</b>: satu PIN untuk semua
                  aplikasi. Lupa PIN? Buat PIN baru di sana dengan kata sandi akun.
                </span>
                {status.accountUrl && (
                  <Button asChild size="sm" variant={status.hasPin ? "outline" : "default"}>
                    <a href={`${status.accountUrl}#pin`} target="_blank" rel="noreferrer">
                      <ExternalLink /> {status.hasPin ? "Kelola PIN" : "Atur PIN"}
                    </a>
                  </Button>
                )}
              </div>
            ) : (
              <p className="rounded-xl border p-3 text-sm text-muted-foreground">
                PIN diatur di <b>akun Workingspace</b> (satu PIN untuk semua aplikasi).
              </p>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
