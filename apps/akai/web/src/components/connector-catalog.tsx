import { ArrowLeft, Check, Copy, ExternalLink, KeyRound, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/api";
import { type Catalog, type CatalogEntry, type Connector, connectorsApi } from "@/lib/connectors";
import { cn } from "@/lib/utils";

/** Warna kotak inisial per kategori (token merek workingspace, bukan logo aplikasi). */
const CATEGORY_TONE: Record<string, string> = {
  kerja: "bg-[color-mix(in_oklab,var(--brand-indigo)_16%,transparent)] text-[var(--brand-indigo)]",
  google:
    "bg-[color-mix(in_oklab,var(--brand-cyan)_18%,transparent)] text-[color-mix(in_oklab,var(--brand-cyan)_70%,black)]",
  desain: "bg-[color-mix(in_oklab,var(--brand-coral)_18%,transparent)] text-[var(--brand-coral)]",
  komunikasi:
    "bg-[color-mix(in_oklab,var(--brand-lime)_25%,transparent)] text-[color-mix(in_oklab,var(--brand-lime)_45%,black)]",
  file: "bg-muted text-foreground",
  dev: "bg-[color-mix(in_oklab,var(--brand-indigo)_10%,transparent)] text-foreground",
  bisnis: "bg-[color-mix(in_oklab,var(--brand-coral)_10%,transparent)] text-foreground",
  riset: "bg-[color-mix(in_oklab,var(--brand-cyan)_10%,transparent)] text-foreground",
};

const initials = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 &.]/g, "")
    .split(/[\s&.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function AppAvatar({ name, category, className }: { name: string; category?: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
        CATEGORY_TONE[category ?? ""] ?? "bg-muted",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const AUTH_LABEL = { oauth: "Masuk akun", token: "Token", none: "Tanpa login" } as const;

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Salin"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/**
 * Sambungkan konektor OAuth: jendela dibuka **saat klik** (penahan pop-up), lalu diarahkan ke halaman izin aplikasi. Callback kembali
 * ke /connectors di jendela itu, yang memberi tahu jendela ini lewat postMessage lalu menutup diri; daftar juga dipantau tiap 3 dtk.
 */
export function useConnectFlow(onChange: (c: Connector) => void) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  return async function connect(connector: Connector, win?: Window | null) {
    const popup =
      win ?? (connector.authType === "oauth" ? window.open("about:blank", "_blank", "width=560,height=720") : null);
    try {
      const result = await connectorsApi.connect(connector.id);
      if (result.connector) {
        popup?.close();
        onChange(result.connector);
        if (result.connector.status === "connected")
          toast.success(`${connector.name} tersambung: ${result.connector.tools.length} alat.`);
        else toast.error(result.connector.statusMessage ?? "Belum tersambung.");
        return;
      }
      if (!result.authorizationUrl) return;
      if (popup && !popup.closed) popup.location.href = result.authorizationUrl;
      else window.open(result.authorizationUrl, "_blank");
      toast.info(`Beri izin di jendela ${connector.name}. Akai menunggu…`);
      if (timer.current) clearInterval(timer.current);
      const started = Date.now();
      timer.current = setInterval(async () => {
        try {
          const { connectors } = await connectorsApi.list();
          const fresh = connectors.find((c) => c.id === connector.id);
          if (fresh) onChange(fresh);
          const done = fresh?.status === "connected";
          const failed = fresh?.status === "error";
          if (done || failed || Date.now() - started > 5 * 60_000) {
            clearInterval(timer.current!);
            timer.current = null;
            if (done) toast.success(`${connector.name} tersambung: ${fresh!.tools.length} alat.`);
            else if (failed) toast.error(fresh?.statusMessage ?? "Izin gagal.");
          }
        } catch {
          /* coba lagi pada detak berikutnya */
        }
      }, 3000);
    } catch (error) {
      popup?.close();
      toast.error(errorText(error));
    }
  };
}

/** Isian Client ID / Secret / Scope untuk server OAuth tanpa pendaftaran klien dinamis. */
function OAuthClientFields({
  redirectUrl,
  clientId,
  setClientId,
  secret,
  setSecret,
  scope,
  setScope,
  optional,
}: {
  redirectUrl: string | null;
  clientId: string;
  setClientId: (v: string) => void;
  secret: string;
  setSecret: (v: string) => void;
  scope: string;
  setScope: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <>
      {redirectUrl && (
        <Field>
          <FieldLabel>Alamat callback (daftarkan di OAuth client Anda)</FieldLabel>
          <CopyField value={redirectUrl} />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="oc-id">
          Client ID{optional ? " (kosong = pakai milik layanan Google lain)" : ""}
        </FieldLabel>
        <Input id="oc-id" value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono" />
      </Field>
      <Field>
        <FieldLabel htmlFor="oc-secret">Client Secret</FieldLabel>
        <Input
          id="oc-secret"
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="oc-scope">Scope</FieldLabel>
        <Input id="oc-scope" value={scope} onChange={(e) => setScope(e.target.value)} className="font-mono text-xs" />
        <FieldDescription>Bawaan = baca + buat, tanpa hapus. Pisahkan dengan spasi.</FieldDescription>
      </Field>
    </>
  );
}

/** Dialog katalog: cari & pilih aplikasi → isian sesuai cara masuknya → tambah (OAuth langsung membuka jendela izin). */
export function CatalogPicker({
  existing,
  onCancel,
  onAdded,
  connect,
}: {
  existing: Connector[];
  onCancel: () => void;
  onAdded: (c: Connector) => void;
  connect: (c: Connector, win?: Window | null) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    let alive = true;
    connectorsApi
      .catalog()
      .then((c) => alive && setCatalog(c))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  const added = useMemo(() => new Set(existing.map((c) => c.preset).filter(Boolean)), [existing]);
  const entries = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog?.entries ?? []).filter(
      (e) =>
        (!category || e.category === category) &&
        words.every((w) => `${e.name} ${e.description} ${e.key}`.toLowerCase().includes(w)),
    );
  }, [catalog, query, category]);

  if (picked)
    return (
      <EntryForm
        entry={picked}
        redirectUrl={catalog?.redirectUrl ?? null}
        hasGroupClient={
          !!picked.group &&
          existing.some(
            (c) =>
              c.oauthClientId && c.preset && catalog?.entries.find((e) => e.key === c.preset)?.group === picked.group,
          )
        }
        onBack={() => setPicked(null)}
        onAdded={onAdded}
        connect={connect}
      />
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tambah aplikasi</DialogTitle>
        <DialogDescription>
          Aplikasi dengan server MCP resmi. Kebanyakan cukup masuk dengan akun Anda; beberapa butuh token atau OAuth
          client sendiri.
        </DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari aplikasi…"
          className="pl-8"
          autoFocus
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant={category === null ? "secondary" : "ghost"} onClick={() => setCategory(null)}>
          Semua
        </Button>
        {Object.entries(catalog?.categories ?? {}).map(([key, label]) => (
          <Button
            key={key}
            size="xs"
            variant={category === key ? "secondary" : "ghost"}
            onClick={() => setCategory(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {!catalog ? (
        <Spinner className="mx-auto my-8 size-6" />
      ) : (
        <div className="grid max-h-[50svh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {entries.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setPicked(e)}
              className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm"
            >
              <AppAvatar name={e.name} category={e.category} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{e.name}</span>
                  {added.has(e.key) && <Check className="size-3.5 shrink-0 text-success" />}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{e.description}</span>
                <span className="mt-1 flex gap-1">
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                    {e.needsClient ? "OAuth client sendiri" : AUTH_LABEL[e.auth]}
                  </Badge>
                </span>
              </span>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              Tidak ada yang cocok. Pakai "Alamat sendiri" untuk server MCP lain.
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Tutup
        </Button>
      </DialogFooter>
    </>
  );
}

function EntryForm({
  entry,
  redirectUrl,
  hasGroupClient,
  onBack,
  onAdded,
  connect,
}: {
  entry: CatalogEntry;
  redirectUrl: string | null;
  hasGroupClient: boolean;
  onBack: () => void;
  onAdded: (c: Connector) => void;
  connect: (c: Connector, win?: Window | null) => Promise<void>;
}) {
  const [authType, setAuthType] = useState(entry.auth);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [scope, setScope] = useState(entry.scope ?? "");
  const [url, setUrl] = useState(entry.url);
  const [busy, setBusy] = useState(false);
  // GitHub: token, atau OAuth dengan OAuth App milik pemilik
  const canSwitchToOAuth = entry.key === "github";
  const needsClient = authType === "oauth" && (entry.needsClient || canSwitchToOAuth);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Jendela izin dibuka sekarang (masih dalam klik) agar tidak ditahan penahan pop-up
    const win = authType === "oauth" ? window.open("about:blank", "_blank", "width=560,height=720") : null;
    try {
      const created = await connectorsApi.create({
        kind: "custom",
        preset: entry.key,
        url: url !== entry.url ? url : undefined,
        authType,
        token: authType === "token" ? token : undefined,
        ...(authType === "oauth"
          ? { oauthClientId: clientId || undefined, oauthClientSecret: secret || undefined, oauthScope: scope }
          : {}),
      });
      onAdded(created);
      if (authType === "oauth") await connect(created, win);
      else if (created.status === "connected")
        toast.success(`${created.name} tersambung: ${created.tools.length} alat.`);
      else toast.error(created.statusMessage ?? "Ditambahkan tetapi belum tersambung.");
    } catch (error) {
      win?.close();
      toast.error(errorText(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button type="button" size="icon-sm" variant="ghost" onClick={onBack} aria-label="Kembali ke katalog">
            <ArrowLeft />
          </Button>
          <AppAvatar name={entry.name} category={entry.category} className="size-7 rounded-lg text-xs" />
          {entry.name}
        </DialogTitle>
        <DialogDescription>{entry.description}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{entry.hint}</p>
        {canSwitchToOAuth && (
          <div className="flex gap-1">
            <Button
              type="button"
              size="xs"
              variant={authType === "token" ? "secondary" : "ghost"}
              onClick={() => setAuthType("token")}
            >
              <KeyRound data-icon="inline-start" /> Token
            </Button>
            <Button
              type="button"
              size="xs"
              variant={authType === "oauth" ? "secondary" : "ghost"}
              onClick={() => setAuthType("oauth")}
            >
              OAuth App
            </Button>
          </div>
        )}
        {authType === "token" && (
          <Field>
            <FieldLabel htmlFor="e-token">Token akses</FieldLabel>
            <Input
              id="e-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </Field>
        )}
        {needsClient && (
          <OAuthClientFields
            redirectUrl={redirectUrl}
            clientId={clientId}
            setClientId={setClientId}
            secret={secret}
            setSecret={setSecret}
            scope={scope}
            setScope={setScope}
            optional={hasGroupClient}
          />
        )}
        <details className="rounded-xl border px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Lanjutan: alamat server MCP</summary>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-2 font-mono text-xs" />
        </details>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Kembali
        </Button>
        <Button
          type="submit"
          disabled={
            busy || (authType === "token" && !token.trim()) || (needsClient && !hasGroupClient && !clientId.trim())
          }
        >
          {busy ? <Spinner /> : authType === "oauth" ? <ExternalLink data-icon="inline-start" /> : null}
          {authType === "oauth" ? "Sambungkan" : "Tambahkan"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Ubah OAuth client / scope konektor yang sudah ada (izin lama dibuang server → Sambungkan lagi). */
export function OAuthSettingsForm({
  connector,
  redirectUrl,
  onCancel,
  onSaved,
}: {
  connector: Connector;
  redirectUrl: string | null;
  onCancel: () => void;
  onSaved: (c: Connector) => void;
}) {
  const [clientId, setClientId] = useState(connector.oauthClientId ?? "");
  const [secret, setSecret] = useState("");
  const [scope, setScope] = useState(connector.oauthScope ?? "");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(
        await connectorsApi.update(connector.id, {
          oauthClientId: clientId,
          ...(secret ? { oauthClientSecret: secret } : {}),
          oauthScope: scope,
        }),
      );
      toast.success("Pengaturan OAuth disimpan. Tekan Sambungkan bila izin perlu diberikan lagi.");
    } catch (error) {
      toast.error(errorText(error));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Pengaturan OAuth {connector.name}</DialogTitle>
        <DialogDescription>
          {connector.hasClientSecret
            ? "Client Secret tersimpan; kosongkan bila tidak diganti."
            : "Client Secret belum ada."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <OAuthClientFields
          redirectUrl={redirectUrl}
          clientId={clientId}
          setClientId={setClientId}
          secret={secret}
          setSecret={setSecret}
          scope={scope}
          setScope={setScope}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />} Simpan
        </Button>
      </DialogFooter>
    </form>
  );
}
