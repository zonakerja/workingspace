import { CloudUpload, ExternalLink, Loader2, Snowflake, TimerReset } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDriveBackup, useDriveBackupMutations } from "@/data/use-drive";
import { errorMessage } from "@/lib/api/client";
import { useSsoConfig } from "@/data/use-auth";
import { useToday } from "@/hooks/use-today";
import { useAuthStore } from "@/stores/auth-store";
import { accessBannerInfo } from "./access-logic";

/**
 * Pita masa akses di atas konten: akses hampir habis (≤ 14 hari) atau sudah habis (baca saja, dibekukan 180 hari lalu data
 * dihapus). Perpanjangan diajukan di akun Workingspace (SSO); Backup ke Drive = backup sekarang bila akun Drive sudah dipilih,
 * selain itu membuka kartu Backup di Pengaturan → Akun Tersambung.
 */
export function AccessBanner() {
  const user = useAuthStore((s) => s.user);
  const { data: sso } = useSsoConfig();
  const today = useToday();
  const info = accessBannerInfo(user, today);
  if (!info) return null;
  const renewUrl = sso?.accountUrl ? `${sso.accountUrl}#akses` : null;
  const backupButton = <BackupButton />;

  if (info.kind === "expiring")
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-info/30 bg-info/10 px-3 py-2 text-sm text-info md:px-5">
        <TimerReset className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          Masa akses Akasha berakhir <b>{info.expiresLabel}</b> ({info.daysLeft} hari lagi). Setelah itu data hanya bisa
          dibaca.
        </span>
        {backupButton}
        {renewUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={renewUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Ajukan perpanjangan
            </a>
          </Button>
        )}
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/15 px-3 py-2.5 text-sm md:px-5">
      <Snowflake className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <b>Data Anda dibekukan (baca saja).</b> Masa akses berakhir {info.expiresLabel}. Data akan dihapus permanen pada{" "}
        <b>{info.deleteLabel}</b> ({info.daysLeft} hari lagi) — cadangkan data Anda sebelum itu.
      </span>
      {backupButton}
      {renewUrl && (
        <Button asChild size="sm">
          <a href={renewUrl} target="_blank" rel="noreferrer">
            <ExternalLink /> Ajukan perpanjangan
          </a>
        </Button>
      )}
    </div>
  );
}

function BackupButton() {
  const navigate = useNavigate();
  const { data } = useDriveBackup();
  const { run } = useDriveBackupMutations();
  const running = !!data?.running;
  const click = () => {
    if (!data?.settings.accountId) {
      void navigate("/settings/accounts#backup");
      return;
    }
    run.mutate(undefined, {
      onSuccess: () => toast.success("Backup ke Drive dimulai. Lihat hasilnya di Pengaturan → Akun Tersambung."),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  return (
    <Button size="sm" variant="outline" disabled={running || run.isPending} onClick={click}>
      {running ? <Loader2 className="animate-spin" /> : <CloudUpload />}{" "}
      {running ? "Backup berjalan…" : "Backup ke Drive"}
    </Button>
  );
}
