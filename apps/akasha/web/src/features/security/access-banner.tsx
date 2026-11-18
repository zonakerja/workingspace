import { CloudUpload, ExternalLink, Snowflake, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSsoConfig } from "@/data/use-auth";
import { useToday } from "@/hooks/use-today";
import { useAuthStore } from "@/stores/auth-store";
import { accessBannerInfo } from "./access-logic";

/**
 * Pita masa akses di atas konten: akses hampir habis (≤ 14 hari) atau sudah habis (baca saja, dibekukan 180 hari lalu data
 * dihapus). Perpanjangan diajukan di akun Workingspace (SSO); backup ke Google Drive menyusul.
 */
export function AccessBanner() {
  const user = useAuthStore((s) => s.user);
  const { data: sso } = useSsoConfig();
  const today = useToday();
  const info = accessBannerInfo(user, today);
  if (!info) return null;
  const renewUrl = sso?.accountUrl ? `${sso.accountUrl}#akses` : null;

  if (info.kind === "expiring")
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-info/30 bg-info/10 px-3 py-2 text-sm text-info md:px-5">
        <TimerReset className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          Masa akses Akasha berakhir <b>{info.expiresLabel}</b> ({info.daysLeft} hari lagi). Setelah itu data hanya bisa
          dibaca.
        </span>
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
      <Button size="sm" variant="outline" disabled title="Backup seluruh data ke Google Drive segera tersedia">
        <CloudUpload /> Backup ke Google Drive (segera)
      </Button>
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
