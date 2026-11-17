import { ChevronDown, KeyRound, Plug, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AkaiMark } from "@/components/akai-mark";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/api";
import { type Connector, connectorsApi, toolAccess, toolUsable } from "@/lib/connectors";
import { cn } from "@/lib/utils";

const STATUS: Record<Connector["status"], { label: string; className: string }> = {
  connected: { label: "Tersambung", className: "bg-success/15 text-success" },
  auth_required: { label: "Token ditolak", className: "bg-warning/15 text-warning" },
  error: { label: "Gagal tersambung", className: "bg-destructive/15 text-destructive" },
  new: { label: "Belum dicek", className: "bg-muted text-muted-foreground" },
};

const ACCESS = {
  read: { label: "Baca", className: "bg-success/10 text-success" },
  write: { label: "Ubah", className: "bg-warning/10 text-warning" },
  destructive: { label: "Hapus", className: "bg-destructive/10 text-destructive" },
} as const;

/** Konektor MCP Akai (6b.5): alat dari Akasha & aplikasi lain yang bisa dipakai Akai saat chat, dengan izin per konektor. */
export function ConnectorsPage() {
  const [data, setData] = useState<{ akashaAvailable: boolean; connectors: Connector[] } | null>(null);
  const [adding, setAdding] = useState<"akasha" | "custom" | null>(null);
  const [deleting, setDeleting] = useState<Connector | null>(null);

  useEffect(() => {
    let alive = true;
    connectorsApi
      .list()
      .then((value) => alive && setData(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setData(await connectorsApi.list());
  const replace = (c: Connector) =>
    setData((d) => (d ? { ...d, connectors: d.connectors.map((x) => (x.id === c.id ? c : x)) } : d));

  async function patch(c: Connector, body: Parameters<typeof connectorsApi.update>[1]) {
    try {
      replace(await connectorsApi.update(c.id, body));
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function refresh(c: Connector) {
    try {
      const next = await connectorsApi.refresh(c.id);
      replace(next);
      if (next.status === "connected") toast.success(`${c.name}: ${next.tools.length} alat.`);
      else toast.error(next.statusMessage ?? "Gagal tersambung.");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const hasAkasha = data?.connectors.some((c) => c.kind === "akasha");
  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-aurora px-5 py-5 text-ink-foreground md:px-7">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display flex items-center gap-2 text-xl font-bold md:text-2xl">
              <Plug className="size-6" /> Konektor
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Sambungkan Akai ke Akasha dan aplikasi lain (protokol MCP) agar Akai bisa mencari dan memakai data Anda
              saat menjawab — mis. catatan Knowledge, agenda, dan to-do.
            </p>
          </div>
          <div className="flex gap-2">
            {data?.akashaAvailable && !hasAkasha && (
              <Button variant="secondary" onClick={() => setAdding("akasha")}>
                <Plus data-icon="inline-start" /> Akasha
              </Button>
            )}
            <Button variant="secondary" onClick={() => setAdding("custom")}>
              <Plus data-icon="inline-start" /> Server MCP lain
            </Button>
          </div>
        </div>
      </section>

      {!data ? (
        <Spinner className="mx-auto size-6" />
      ) : data.connectors.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <Plug className="size-8" />
          Belum ada konektor.
          {data.akashaAvailable && (
            <Button onClick={() => setAdding("akasha")}>
              <Plus data-icon="inline-start" /> Sambungkan Akasha
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.connectors.map((c) => {
            // Konektor yang belum pernah diberi token (mis. dari paket) = perlu token, bukan "ditolak"
            const status =
              c.status === "auth_required" && !c.hasToken
                ? { label: "Perlu token", className: STATUS.auth_required.className }
                : STATUS[c.status];
            const usable = c.tools.filter((t) => toolUsable(t, c.allowWrite)).length;
            return (
              <section key={c.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {c.kind === "akasha" ? (
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                        Ak
                      </span>
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                        <Plug className="size-5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {c.name}
                        <Badge className={cn("font-normal", status.className)}>{status.label}</Badge>
                        {c.pluginId && (
                          <Badge variant="outline" className="font-normal" title="Dibuat oleh paket di menu Plugin">
                            Dari paket
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.url ?? "—"} · {c.hasToken ? `token …${c.tokenHint ?? ""}` : "tanpa token"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => void refresh(c)}>
                      <RefreshCw data-icon="inline-start" /> Muat ulang
                    </Button>
                    <TokenButton connector={c} onSaved={replace} />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label="Hapus konektor"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {c.statusMessage && <p className="text-xs text-destructive">{c.statusMessage}</p>}
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch checked={c.enabled} onCheckedChange={(enabled) => void patch(c, { enabled })} />
                    Dipakai Akai saat chat
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch checked={c.allowWrite} onCheckedChange={(allowWrite) => void patch(c, { allowWrite })} />
                    Izinkan alat yang mengubah data
                  </label>
                </div>
                <details className="group rounded-xl border">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {c.tools.length} alat · <b>{usable}</b> dipakai Akai
                    </span>
                    <ChevronDown className="size-4 transition group-open:rotate-180" />
                  </summary>
                  <ul className="flex max-h-80 flex-col divide-y overflow-y-auto border-t">
                    {c.tools.map((t) => {
                      const access = toolAccess(t);
                      const on = toolUsable(t, c.allowWrite);
                      return (
                        <li key={t.name} className={cn("flex items-start gap-2 px-3 py-2", !on && "opacity-55")}>
                          <Badge className={cn("mt-0.5 shrink-0 font-normal", ACCESS[access].className)}>
                            {ACCESS[access].label}
                          </Badge>
                          <div className="min-w-0">
                            <p className="font-mono text-xs">{t.name}</p>
                            {t.description && (
                              <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </section>
            );
          })}
        </div>
      )}

      <section className="flex items-start gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          Alat bertanda <b>Baca</b> selalu boleh dipakai Akai; alat <b>Ubah</b> hanya bila Anda mengizinkannya; alat{" "}
          <b>Hapus</b> tidak pernah dipakai dari chat (aplikasi lain tidak punya Sampah Akai). Token disimpan
          terenkripsi dan tidak pernah dikirim ke browser maupun ke model.
        </p>
      </section>

      <Dialog open={!!adding} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-lg">
          {adding && (
            <AddConnectorForm
              kind={adding}
              onCancel={() => setAdding(null)}
              onAdded={async (c) => {
                setAdding(null);
                await reload();
                if (c.status === "connected") toast.success(`${c.name} tersambung: ${c.tools.length} alat.`);
                else toast.error(c.statusMessage ?? "Konektor ditambahkan tetapi belum tersambung.");
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus konektor?"
        description={`Akai tidak lagi bisa memakai alat "${deleting?.name ?? ""}". Token yang tersimpan ikut dihapus.`}
        onConfirm={async () => {
          if (!deleting) return false;
          try {
            await connectorsApi.remove(deleting.id);
            setDeleting(null);
            await reload();
            return true;
          } catch (error) {
            toast.error(errorText(error));
            return false;
          }
        }}
      />
    </div>
  );
}

function AddConnectorForm({
  kind,
  onCancel,
  onAdded,
}: {
  kind: "akasha" | "custom";
  onCancel: () => void;
  onAdded: (c: Connector) => Promise<void>;
}) {
  const [name, setName] = useState(kind === "akasha" ? "Akasha" : "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onAdded(await connectorsApi.create({ kind, name, url, token }));
    } catch (error) {
      toast.error(errorText(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {kind === "akasha" ? <AkaiMark className="size-6" /> : <Plug className="size-5" />}
          {kind === "akasha" ? "Sambungkan Akasha" : "Server MCP lain"}
        </DialogTitle>
        <DialogDescription>
          {kind === "akasha"
            ? "Akai memakai MCP Akasha (Knowledge, agenda, to-do, pengajuan) dengan token akses pribadi Anda."
            : "Alamat server MCP (Streamable HTTP atau SSE) dan token aksesnya bila diperlukan."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {kind === "custom" && (
          <>
            <Field>
              <FieldLabel htmlFor="c-name">Nama</FieldLabel>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="mis. Notion"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-url">Alamat server MCP</FieldLabel>
              <Input
                id="c-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://contoh.com/mcp"
                className="font-mono"
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="c-token">Token akses{kind === "custom" ? " (opsional)" : ""}</FieldLabel>
          <Input
            id="c-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={kind === "akasha" ? "akasha_pat_…" : "Bearer token"}
            className="font-mono"
          />
          {kind === "akasha" && (
            <FieldDescription>
              Buat di Akasha → Pengaturan → Integrasi → Buat token. Centang izin yang boleh dipakai Akai, mis. Basis
              pengetahuan (baca), Data kerja (baca), dan Data kerja (tulis) bila Akai boleh membuat to-do.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy || (kind === "akasha" ? !token.trim() : !name.trim() || !url.trim())}>
          {busy && <Spinner />} Sambungkan
        </Button>
      </DialogFooter>
    </form>
  );
}

function TokenButton({ connector, onSaved }: { connector: Connector; onSaved: (c: Connector) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await connectorsApi.update(connector.id, { token });
      onSaved(next);
      setOpen(false);
      setToken("");
      if (next.status === "connected") toast.success("Token diganti, konektor tersambung.");
      else toast.error(next.statusMessage ?? "Token tersimpan tetapi belum tersambung.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <KeyRound data-icon="inline-start" /> Token
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save} className="contents">
            <DialogHeader>
              <DialogTitle>Ganti token {connector.name}</DialogTitle>
              <DialogDescription>Token lama diganti. Kosongkan untuk menghapus token.</DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Batal
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />} Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
