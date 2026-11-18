import { ArchiveRestore, Play, Snowflake, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useColdStorage, useColdStorageMutations } from "@/data/use-drive";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import type { ColdStorageSettings } from "@/types/api";
import { COLD_DAY_OPTIONS, COLD_SIZE_OPTIONS, dayLabel, formatSize, PROVIDER_DRIVE_LABEL } from "./drive-utils";

/**
 * Arsip dingin (docs/AKUN-TERSAMBUNG.md tahap 4b): berkas yang lama tidak dibuka dipindah ke Google Drive / OneDrive untuk menghemat
 * disk server, lalu otomatis diambil kembali saat dibuka dari fitur mana pun.
 */
export function ColdStorageCard() {
  const { data, isLoading } = useColdStorage();
  const m = useColdStorageMutations();
  const [confirm, setConfirm] = useState<"enable" | "restore" | null>(null);
  const fail = (error: unknown) => toast.error(errorMessage(error));
  const save = (input: Partial<ColdStorageSettings>) => m.update.mutate(input, { onError: fail });

  return (
    <SectionCard
      icon={Snowflake}
      title="Arsip dingin (Drive)"
      description="Berkas yang lama tidak dibuka dipindah ke Google Drive / OneDrive Anda agar disk server lega. Saat dibuka lagi, berkas diambil kembali otomatis."
    >
      {isLoading || !data ? (
        <Skeleton className="h-24" />
      ) : !data.accounts.length ? (
        <p className="text-sm text-muted-foreground">
          Belum ada akun dengan izin Drive. Di kartu Google & Microsoft di atas, tekan <b>Izinkan Drive</b> pada salah
          satu akun.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <Switch
                checked={data.settings.enabled}
                disabled={m.update.isPending || data.running === "restore"}
                onCheckedChange={(enabled) => (enabled ? setConfirm("enable") : save({ enabled: false }))}
              />
              Pindahkan otomatis (tiap jam)
            </label>
            <Select
              value={data.settings.accountId ?? ""}
              onValueChange={(accountId) => save({ accountId })}
              disabled={m.update.isPending}
            >
              <SelectTrigger size="sm" className="min-w-56">
                <SelectValue placeholder="Pilih akun Drive" />
              </SelectTrigger>
              <SelectContent>
                {data.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {PROVIDER_DRIVE_LABEL[a.provider]} · {a.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Berkas yang tidak dibuka selama</span>
            <Select value={String(data.settings.afterDays)} onValueChange={(v) => save({ afterDays: Number(v) })}>
              <SelectTrigger size="sm">
                <SelectValue>{dayLabel(data.settings.afterDays)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLD_DAY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">dengan ukuran</span>
            <Select value={String(data.settings.minSizeMb)} onValueChange={(v) => save({ minSizeMb: Number(v) })}>
              <SelectTrigger size="sm">
                <SelectValue>
                  {COLD_SIZE_OPTIONS.find((o) => o.value === data.settings.minSizeMb)?.label ??
                    `≥ ${data.settings.minSizeMb} MB`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLD_SIZE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Sudah di Drive</p>
              <p className="text-lg font-semibold">
                {data.stored.count} berkas · {formatSize(data.stored.bytes) || "0 B"}
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Memenuhi syarat sekarang</p>
              <p className="text-lg font-semibold">
                {data.candidates.count} berkas · {formatSize(data.candidates.bytes) || "0 B"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!!data.running || !data.settings.accountId || !data.candidates.count || m.run.isPending}
              onClick={() => m.run.mutate(undefined, { onError: fail })}
            >
              {data.running === "move" ? <Spinner /> : <Play />} Pindahkan sekarang
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!data.running || !data.stored.count || m.restore.isPending}
              onClick={() => setConfirm("restore")}
            >
              {data.running === "restore" ? <Spinner /> : <ArchiveRestore />} Kembalikan semua
            </Button>
            {data.running && (
              <span className="text-xs text-muted-foreground">
                {data.running === "move" ? "Memindahkan ke Drive…" : "Mengembalikan dari Drive…"}
              </span>
            )}
          </div>
          {data.lastRun && !data.running && (
            <p className="text-xs text-muted-foreground">
              {data.lastRun.kind === "move" ? "Pemindahan" : "Pengembalian"} terakhir {formatDateTime(data.lastRun.at)}:{" "}
              {data.lastRun.done} berkas ({formatSize(data.lastRun.bytes) || "0 B"})
              {data.lastRun.failed ? `, ${data.lastRun.failed} gagal` : ""}.
              {data.lastRun.error && <span className="block text-destructive">{data.lastRun.error}</span>}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Berkas yang dipindah hanya tersimpan di Drive Anda (backup harian server tidak lagi memuatnya). Jangan hapus
            folder "Akasha Arsip" (Google) / "Apps › Arsip dingin" (OneDrive). Berkas bertautan publik, di brankas,
            templat, sumber Notebook, dan berkas vault tidak pernah dipindah. Membuka berkas yang ada di Drive butuh
            beberapa detik lebih lama.
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirm === "enable"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Nyalakan arsip dingin?"
        description={`Setiap jam, berkas yang tidak dibuka selama ${dayLabel(data?.settings.afterDays ?? 180)} dipindah ke Drive dan dihapus dari server. Salinan satu-satunya ada di Drive Anda; backup harian server tidak lagi memuatnya.`}
        confirmLabel="Nyalakan"
        onConfirm={() => save({ enabled: true })}
      />
      <ConfirmDialog
        open={confirm === "restore"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Kembalikan semua berkas?"
        description="Semua berkas arsip dingin diunduh kembali ke server lalu dihapus dari Drive. Pemindahan otomatis dimatikan. Pastikan disk server cukup."
        confirmLabel="Kembalikan"
        onConfirm={() => m.restore.mutate(undefined, { onError: fail })}
      />
    </SectionCard>
  );
}
