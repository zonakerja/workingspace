import { CircleAlert, CircleCheck, CloudUpload, DatabaseBackup, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDriveBackup, useDriveBackupMutations } from "@/data/use-drive";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import type { DriveBackupSettings } from "@/types/api";
import {
  BACKUP_SCHEDULE_OPTIONS,
  BACKUP_TRIGGER_LABEL,
  backupSummary,
  formatSize,
  PROVIDER_DRIVE_LABEL,
} from "./drive-utils";

const KEEP_OPTIONS = [1, 3, 5, 10, 20];
const PHASE_LABEL = {
  data: "Mengumpulkan data…",
  files: "Menyalin berkas",
  finishing: "Menyimpan daftar backup…",
} as const;

/**
 * Backup seluruh data Akasha ke Google Drive / OneDrive Anda: tombol Backup sekarang, jadwal mingguan/bulanan, dan otomatis saat
 * masa akses hampir / sudah habis. Satu backup = folder "Backup <tanggal>" berisi akasha-backup.json + berkas di folder "berkas".
 */
export function DriveBackupCard() {
  const { data, isLoading } = useDriveBackup();
  const m = useDriveBackupMutations();
  const fail = (error: unknown) => toast.error(errorMessage(error));
  const save = (input: Partial<DriveBackupSettings>) => m.update.mutate(input, { onError: fail });
  const running = data?.running;

  return (
    <div id="backup" className="scroll-mt-16">
      <SectionCard
        icon={DatabaseBackup}
        title="Backup ke Drive"
        description="Salinan seluruh data Akasha (data kerja, My Notebook, Pengajuan, berkas) ke Google Drive / OneDrive Anda — kapan saja lewat tombol, terjadwal, dan otomatis saat masa akses hampir habis."
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
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={data.settings.accountId ?? ""}
                onValueChange={(accountId) => save({ accountId })}
                disabled={m.update.isPending || !!running}
              >
                <SelectTrigger size="sm" className="min-w-56">
                  <SelectValue placeholder="Pilih akun Drive tujuan" />
                </SelectTrigger>
                <SelectContent>
                  {data.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {PROVIDER_DRIVE_LABEL[a.provider]} · {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={data.settings.schedule}
                onValueChange={(schedule) => save({ schedule: schedule as DriveBackupSettings["schedule"] })}
                disabled={m.update.isPending}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKUP_SCHEDULE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(data.settings.keep)} onValueChange={(v) => save({ keep: Number(v) })}>
                <SelectTrigger size="sm">
                  <SelectValue>Simpan {data.settings.keep} backup</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {KEEP_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Simpan {n} backup terakhir
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2">
                <Switch
                  checked={data.settings.includeFiles}
                  disabled={m.update.isPending}
                  onCheckedChange={(includeFiles) => save({ includeFiles })}
                />
                Sertakan berkas (lampiran, dokumen)
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={data.settings.onExpiry}
                  disabled={m.update.isPending}
                  onCheckedChange={(onExpiry) => save({ onExpiry })}
                />
                Backup otomatis saat masa akses tinggal 7 hari / sudah habis
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!!running || !data.settings.accountId || m.run.isPending}
                onClick={() =>
                  m.run.mutate(undefined, {
                    onSuccess: () => toast.success("Backup dimulai. Anda boleh meninggalkan halaman ini."),
                    onError: fail,
                  })
                }
              >
                {running ? <Loader2 className="animate-spin" /> : <CloudUpload />} Backup sekarang
              </Button>
              {running && (
                <span className="text-xs text-muted-foreground">
                  {PHASE_LABEL[running.phase]}
                  {running.phase === "files" && running.total ? ` ${running.done}/${running.total}` : ""}
                </span>
              )}
              {!running && data.stored.files > 0 && (
                <span className="text-xs text-muted-foreground">
                  {data.stored.files} berkas tersimpan di Drive ({formatSize(data.stored.bytes) || "0 B"}), dipakai
                  bersama antar-backup.
                </span>
              )}
            </div>

            {data.runs.length > 0 && (
              <ul className="flex flex-col divide-y rounded-xl border">
                {data.runs.slice(0, 5).map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    {run.status === "done" ? (
                      <CircleCheck className="size-4 text-success" />
                    ) : run.status === "failed" ? (
                      <CircleAlert className="size-4 text-destructive" />
                    ) : (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    <span className="font-medium">{formatDateTime(run.startedAt)}</span>
                    <Badge variant="outline">{BACKUP_TRIGGER_LABEL[run.trigger]}</Badge>
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {run.status === "failed" ? (
                        <span className="text-destructive">{run.error}</span>
                      ) : (
                        backupSummary(run.stats)
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Lokasi: folder <b>Akasha Backup</b> (Google Drive) / <b>Apps › Backup</b> (OneDrive). Item yang dikunci
              PIN ikut tersalin apa adanya, jadi gunakan akun Drive pribadi. Backup tetap bisa dijalankan saat data
              dibekukan (baca saja).
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
