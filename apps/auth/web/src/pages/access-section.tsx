import { ArrowUpRight, Clock, History, LayoutGrid, Send, Snowflake, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProductMark } from "@workingspace/ui/brand";
import { PRODUCTS, productName } from "@workingspace/ui/ecosystem";
import { Notice } from "@/components/auth-layout";
import { Section, StatusPill } from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PURPOSE_MAX, accessLabel, durationLabel, purposeHint } from "@/lib/access";
import { type AccessOverview, api, errorText } from "@/lib/api";
import { ROLE_LABELS, formatDateTime } from "@/lib/format";

type OverviewApp = AccessOverview["apps"][number];

const UPCOMING_APPS = PRODUCTS.filter((p) => !p.available);
const taglineOf = (key: string) => PRODUCTS.find((p) => p.key === key)?.tagline;
const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const STATUS_PILL = {
  pending: { tone: "info", label: "Menunggu" },
  approved: { tone: "success", label: "Disetujui" },
  rejected: { tone: "danger", label: "Belum disetujui" },
} as const;

/**
 * Halaman akun → Akses: aplikasi yang bisa dibuka (dengan masa aksesnya), pengajuan akses / perpanjangan dengan tujuan,
 * dan riwayat pengajuan. Anchor `#akses` dipakai email pengingat masa akses.
 */
export function AccessSection() {
  const [data, setData] = useState<AccessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<OverviewApp | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .access()
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const mine = data?.apps.filter((a) => a.role) ?? [];
  const others = data?.apps.filter((a) => !a.role) ?? [];
  const upcoming = UPCOMING_APPS.filter((p) => !data?.apps.some((a) => a.key === p.key));

  return (
    <Section
      id="akses"
      icon={<LayoutGrid />}
      eyebrow="Akses"
      title="Aplikasi Anda"
      description="Masuk sekali, buka aplikasi mana pun. Akses diberikan terbatas — ajukan dengan menjelaskan tujuan Anda."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {notice && (
        <div className="mb-3">
          <Notice tone="success">{notice}</Notice>
        </div>
      )}
      {!data && !error && <Spinner className="mx-auto my-6" />}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((app) => (
            <MyAppCard key={app.key} app={app} onRenew={() => setRequesting(app)} />
          ))}
          {others.map((app) => (
            <RequestCard key={app.key} app={app} onRequest={() => setRequesting(app)} />
          ))}
          {upcoming.map((app) => (
            <div
              key={app.key}
              className="flex flex-col gap-4 rounded-2xl border border-dashed bg-surface/60 p-4 text-muted-foreground"
            >
              <ProductMark appKey={app.key} name={app.name} className="size-12 opacity-60 grayscale-[35%]" />
              <div className="min-w-0">
                <p className="font-display truncate text-lg font-bold text-foreground/70">{app.name}</p>
                <p className="truncate text-xs font-medium italic">{app.tagline}</p>
                <p className="mt-1 line-clamp-2 text-xs">{app.lead}</p>
              </div>
              <StatusPill tone="info" className="self-start">
                <Sparkles /> Segera hadir
              </StatusPill>
            </div>
          ))}
        </div>
      )}
      {data && data.requests.length > 0 && (
        <details className="mt-5 rounded-2xl border p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" /> Riwayat pengajuan ({data.requests.length})
          </summary>
          <ul className="mt-3 flex flex-col divide-y">
            {data.requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{productName(r.appKey, r.appName)}</b>
                  <StatusPill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].label}</StatusPill>
                  <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                  {r.status === "approved" && (
                    <span className="text-xs text-muted-foreground">
                      · {r.role ? ROLE_LABELS[r.role] : ""} · {durationLabel(r.durationDays)}
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{r.purpose}</p>
                {r.note && <p className="text-xs">Catatan admin: {r.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <RequestDialog
        key={requesting?.key ?? "none"}
        app={requesting}
        onClose={() => setRequesting(null)}
        onSent={(next, name) => {
          setData(next);
          setRequesting(null);
          setNotice(`Pengajuan ${name} terkirim. Admin akan meninjau dan mengabari lewat email.`);
        }}
      />
    </Section>
  );
}

function MyAppCard({ app, onRenew }: { app: OverviewApp; onRenew: () => void }) {
  const label = accessLabel(app.access);
  const frozen = app.access?.state === "read_only";
  return (
    <div className="ring-aurora relative flex flex-col gap-4 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <ProductMark appKey={app.key} name={app.name} className="size-12 shadow-soft" />
        <a
          href={app.url}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          Buka <ArrowUpRight className="size-4" />
        </a>
      </div>
      <div className="min-w-0">
        <p className="font-display truncate text-lg font-bold">{productName(app.key, app.name)}</p>
        {taglineOf(app.key) && <p className="truncate text-xs font-medium text-primary italic">{taglineOf(app.key)}</p>}
        <p className="truncate text-xs text-muted-foreground">{hostOf(app.url)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={app.role === "admin" ? "brand" : "muted"}>{ROLE_LABELS[app.role!]}</StatusPill>
        <StatusPill tone={label.tone}>
          {frozen ? <Snowflake /> : <Clock />} {label.text}
        </StatusPill>
      </div>
      {app.pendingRequestId ? (
        <p className="text-xs text-info">Perpanjangan sedang ditinjau admin.</p>
      ) : (
        app.canRequest && (
          <Button size="sm" variant={frozen ? "default" : "outline"} onClick={onRenew}>
            <Send /> Ajukan perpanjangan
          </Button>
        )
      )}
    </div>
  );
}

function RequestCard({ app, onRequest }: { app: OverviewApp; onRequest: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-dashed p-4">
      <ProductMark appKey={app.key} name={app.name} className="size-12 opacity-80" />
      <div className="min-w-0">
        <p className="font-display truncate text-lg font-bold">{productName(app.key, app.name)}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{taglineOf(app.key) ?? app.description}</p>
      </div>
      {app.pendingRequestId ? (
        <StatusPill tone="info" className="self-start">
          <Clock /> Menunggu persetujuan
        </StatusPill>
      ) : (
        <Button size="sm" onClick={onRequest} disabled={!app.canRequest} title={app.requestBlock ?? undefined}>
          <Send /> Ajukan akses
        </Button>
      )}
    </div>
  );
}

function RequestDialog({
  app,
  onClose,
  onSent,
}: {
  app: OverviewApp | null;
  onClose: () => void;
  onSent: (data: AccessOverview, name: string) => void;
}) {
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renewal = !!app?.role;
  const hint = purposeHint(purpose);
  const name = app ? productName(app.key, app.name) : "";

  const send = async () => {
    if (!app || hint) return;
    setBusy(true);
    setError(null);
    try {
      onSent(await api.requestAccess([{ appKey: app.key, purpose }]), name);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!app} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {app && <ProductMark appKey={app.key} name={app.name} className="size-11 shadow-soft" />}
            <div>
              <DialogTitle>{renewal ? `Perpanjang akses ${name}` : `Ajukan akses ${name}`}</DialogTitle>
              <DialogDescription>
                {renewal
                  ? "Jelaskan mengapa Anda masih membutuhkan aplikasi ini. Admin menentukan lama perpanjangan."
                  : "Akses diberikan terbatas. Jelaskan tujuan atau kepentingan Anda; admin meninjau dan mengabari lewat email."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="access-purpose">Tujuan / kepentingan</FieldLabel>
          <Textarea
            id="access-purpose"
            rows={4}
            maxLength={PURPOSE_MAX}
            autoFocus
            placeholder="Contoh: mengelola agenda rapat, arsip surat, dan laporan kinerja bulanan unit kerja saya."
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <FieldDescription>
            {hint ?? "Cukup jelas."} · {purpose.length}/{PURPOSE_MAX}
          </FieldDescription>
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={busy || !!hint} onClick={() => void send()}>
            {busy ? <Spinner /> : <Send />} Kirim pengajuan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
