import {
  CalendarCheck2,
  CalendarPlus,
  HardDrive,
  Link2,
  Mail,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { syncSummary, useConnectionMutations, useConnections } from "@/data/use-connections";
import { useSetSearchParams, useSearchParam } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { connectionsApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { OAuthAccountInfo, OAuthProviderId } from "@/types/api";

const PROVIDER: Record<OAuthProviderId, { label: string; note: string }> = {
  google: { label: "Google", note: 'Google Calendar (kalender "Akasha" saja)' },
  microsoft: { label: "Microsoft", note: "Outlook: kalender & email" },
};

/**
 * Akun Google / Microsoft lewat OAuth (docs/AKUN-TERSAMBUNG.md tahap 2): kalender "Akasha" dua arah di Google Calendar / Outlook, dan
 * email Outlook (baca & kirim). Gmail tetap lewat Sandi Aplikasi di kartu Akun email.
 */
export function OAuthAccountsCard() {
  const { data, isLoading } = useConnections();
  const [connected] = useSearchParam("connected");
  const [connectError] = useSearchParam("connect_error");
  const setParams = useSetSearchParams();
  const [starting, setStarting] = useState<OAuthProviderId | null>(null);

  // Hasil kembali dari halaman izin penyedia
  useEffect(() => {
    if (!connected && !connectError) return;
    if (connected) {
      const drive = connected.endsWith("-drive");
      const label = PROVIDER[connected.replace(/-drive$/, "") as OAuthProviderId]?.label ?? connected;
      toast.success(drive ? `Izin Drive akun ${label} diberikan.` : `Akun ${label} tersambung.`);
    }
    if (connectError) toast.error(connectError);
    setParams({ connected: null, connect_error: null });
  }, [connected, connectError, setParams]);

  const start = async (provider: OAuthProviderId) => {
    setStarting(provider);
    try {
      window.location.assign((await connectionsApi.start(provider)).url);
    } catch (error) {
      toast.error(errorMessage(error));
      setStarting(null);
    }
  };

  return (
    <SectionCard
      icon={Link2}
      title="Google & Microsoft"
      description="Kalender dua arah di Google Calendar / Outlook, dan email Outlook. Masuk lewat halaman resmi Google / Microsoft."
    >
      {isLoading || !data ? (
        <Skeleton className="h-20" />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PROVIDER) as OAuthProviderId[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant="outline"
                disabled={!data.configured[p] || starting !== null}
                onClick={() => void start(p)}
                title={data.configured[p] ? undefined : "Belum diatur di server"}
              >
                <Link2 /> Sambungkan {PROVIDER[p].label}
              </Button>
            ))}
          </div>
          {(!data.configured.google || !data.configured.microsoft) && (
            <p className="text-xs text-muted-foreground">
              {[!data.configured.google && "Google", !data.configured.microsoft && "Microsoft"]
                .filter(Boolean)
                .join(" & ")}{" "}
              belum diatur di server (OAuth client milik Anda). Alamat callback yang didaftarkan:{" "}
              <code className="break-all">{data.redirectUri}</code>
            </p>
          )}
          {data.accounts.length === 0 ? (
            <p className="text-muted-foreground">Belum ada akun Google / Microsoft yang tersambung.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function AccountRow({ account: a }: { account: OAuthAccountInfo }) {
  const m = useConnectionMutations();
  const [confirm, setConfirm] = useState<"remove" | "calendar" | null>(null);
  const fail = (error: unknown) => toast.error(errorMessage(error));
  const cal = a.calendar;

  return (
    <li className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{PROVIDER[a.provider].label}</Badge>
        <span className="min-w-0 truncate font-medium">{a.email}</span>
        <span className="text-xs text-muted-foreground">{PROVIDER[a.provider].note}</span>
        {a.status === "error" && <Badge variant="destructive">Perlu disambungkan ulang</Badge>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Putuskan akun"
          onClick={() => setConfirm("remove")}
        >
          <Trash2 />
        </Button>
      </div>
      {a.statusMessage && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {a.statusMessage}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        {cal ? (
          <>
            <CalendarCheck2 className={cn("size-4", cal.status === "error" ? "text-destructive" : "text-success")} />
            <span>Kalender "{cal.calendarName}" dua arah</span>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={cal.enabled}
                onCheckedChange={(enabled) => m.toggleCalendar.mutate({ id: a.id, enabled }, { onError: fail })}
              />
              Sinkron otomatis (± 5 menit)
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={m.syncCalendar.isPending}
              onClick={() =>
                m.syncCalendar.mutate(a.id, { onSuccess: (r) => toast.success(syncSummary(r)), onError: fail })
              }
            >
              <RefreshCw className={cn(m.syncCalendar.isPending && "animate-spin")} /> Sinkron sekarang
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm("calendar")}>
              <Unplug /> Putuskan kalender
            </Button>
            <span className="w-full text-xs text-muted-foreground">
              {cal.status === "error" && cal.statusMessage ? (
                <span className="text-destructive">{cal.statusMessage}</span>
              ) : cal.syncedAt ? (
                `Sinkron terakhir ${formatDateTime(cal.syncedAt)}.`
              ) : (
                "Belum pernah disinkron."
              )}{" "}
              Agenda Planner muncul di kalender "{cal.calendarName}"; acara yang Anda buat / ubah / hapus di kalender
              itu ikut ke Planner.
            </span>
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={m.connectCalendar.isPending || a.status === "error"}
              onClick={() =>
                m.connectCalendar.mutate(a.id, {
                  onSuccess: () => toast.success('Kalender "Akasha" dibuat dan disinkron.'),
                  onError: fail,
                })
              }
            >
              <CalendarPlus /> Sambungkan kalender dua arah
            </Button>
            <span className="text-xs text-muted-foreground">
              Membuat kalender baru "Akasha" di akun ini. Kalender lain milik Anda tidak dibaca.
            </span>
          </>
        )}
      </div>

      <DriveSection account={a} />

      {a.provider === "microsoft" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <Mail className="size-4 text-module" />
          {a.mailAccountId ? (
            <span>Email Outlook aktif — atur kotak masuk & ringkasan di kartu Akun email.</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={m.useForMail.isPending || a.status === "error"}
              onClick={() =>
                m.useForMail.mutate(a.id, {
                  onSuccess: () => toast.success("Email Outlook ditambahkan ke Akun email."),
                  onError: fail,
                })
              }
            >
              Pakai untuk email
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Putuskan akun?"
        itemName={a.email}
        description="Token akses dihapus dari Akasha; kalender dua arah dan email Outlook dari akun ini berhenti. Agenda di Planner dan kalender Akasha di akun Anda tetap ada. Cabut juga izin Akasha di pengaturan keamanan akun Google / Microsoft bila perlu."
        confirmLabel="Putuskan"
        destructive
        onConfirm={() => m.remove.mutate(a.id, { onError: fail })}
      />
      <ConfirmDialog
        open={confirm === "calendar"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Putuskan kalender?"
        description='Sinkron berhenti. Agenda di Planner dan kalender "Akasha" di akun Anda tetap ada (hapus sendiri di Google / Outlook bila tidak dipakai).'
        confirmLabel="Putuskan"
        onConfirm={() => m.disconnectCalendar.mutate(a.id, { onError: fail })}
      />
    </li>
  );
}

/** Izin Drive (tahap 4): pilih berkas dari Drive di form lampiran & arsip dingin. Diminta terpisah agar sambungan kalender tetap sempit. */
function DriveSection({ account: a }: { account: OAuthAccountInfo }) {
  const [starting, setStarting] = useState(false);
  const label = a.provider === "google" ? "Google Drive" : "OneDrive";
  const allow = async () => {
    setStarting(true);
    try {
      window.location.assign((await connectionsApi.start(a.provider, { drive: true, accountId: a.id })).url);
    } catch (error) {
      toast.error(errorMessage(error));
      setStarting(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <HardDrive className={cn("size-4", a.drive ? "text-success" : "text-muted-foreground")} />
      {a.drive ? (
        <span>
          {label} diizinkan — pakai <b>Dari Drive</b> di form lampiran & Resource, atur <b>Arsip dingin</b> di bawah.
        </span>
      ) : (
        <>
          <Button size="sm" variant="outline" disabled={starting || a.status === "error"} onClick={() => void allow()}>
            <HardDrive /> Izinkan {label}
          </Button>
          <span className="text-xs text-muted-foreground">
            {a.provider === "google"
              ? "Akasha hanya melihat berkas yang Anda pilih dan berkas yang dibuat Akasha (izin drive.file)."
              : "Membaca berkas OneDrive yang Anda pilih dan menulis ke folder aplikasi Akasha saja."}
          </span>
        </>
      )}
    </div>
  );
}
