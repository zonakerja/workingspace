import { Boxes, KeyRound, ListRestart, Plug, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ROUTER_PRESETS, SOURCE_KIND_LABEL } from "@/lib/akai-logic";
import { type ApiFormat, type RouterPreset, type Source, type SourceKind, api, errorText } from "@/lib/api";
import { type SettingsData, attempt } from "@/lib/use-settings";
import { ConfirmDialog } from "./confirm-dialog";

type Choice = RouterPreset | Exclude<SourceKind, "router">;

const OFFICIAL: { key: Exclude<SourceKind, "router">; label: string }[] = [
  { key: "gemini", label: "Google Gemini" },
  { key: "anthropic", label: "Anthropic Claude" },
  { key: "openai", label: "OpenAI" },
];

function sourceSubtitle(source: Source) {
  if (source.kind !== "router") return SOURCE_KIND_LABEL[source.kind];
  const preset = ROUTER_PRESETS.find((p) => p.key === source.preset)?.label ?? "Router";
  return `${preset} · format ${source.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"}`;
}

/** Tab Sumber: provider resmi (langsung) atau router, key terenkripsi, uji koneksi, muat katalog model. */
export function SourcesTab({
  data,
  reload,
  onOpenModels,
}: {
  data: SettingsData;
  reload: () => Promise<void>;
  onOpenModels: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [rekey, setRekey] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function test(source: Source) {
    setBusy(`test:${source.id}`);
    try {
      const result = await api.testSource(source.id);
      if (result.ok) toast.success(`Tersambung — ${result.models ?? 0} model terbaca.`);
      else toast.error(result.error ?? "Uji koneksi gagal.");
    } catch (error) {
      toast.error(errorText(error));
    }
    setBusy(null);
    await reload();
  }

  async function catalog(source: Source) {
    setBusy(`catalog:${source.id}`);
    try {
      const { count } = await api.refreshCatalog(source.id);
      toast.success(`Katalog dimuat: ${count} model.`, { action: { label: "Pilih model", onClick: onOpenModels } });
    } catch (error) {
      toast.error(errorText(error));
    }
    setBusy(null);
    await reload();
  }

  const modelCount = (id: string) => data.models.filter((m) => m.sourceId === id).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Sumber = tempat Akai memanggil model: langsung ke provider resmi, atau lewat router (Classai, OpenRouter,
          dll.).
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Tambah sumber
        </Button>
      </div>

      {data.sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
          <Boxes className="size-8 text-muted-foreground" />
          <p className="font-medium">Belum ada sumber model</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Tambahkan router atau API key provider. Setelah itu muat katalog dan nyalakan model yang ingin dipakai.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.sources.map((source) => (
            <article key={source.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{source.label}</h3>
                  <p className="truncate text-xs text-muted-foreground">{sourceSubtitle(source)}</p>
                </div>
                {source.lastStatus === "ok" ? (
                  <Badge className="bg-lime/25 text-foreground">Tersambung</Badge>
                ) : source.lastStatus === "error" ? (
                  <Badge variant="destructive">Galat</Badge>
                ) : (
                  <Badge variant="outline">Belum diuji</Badge>
                )}
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {source.baseUrl && (
                  <>
                    <dt className="text-muted-foreground">Alamat</dt>
                    <dd className="truncate font-mono" title={source.baseUrl}>
                      {source.baseUrl}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">API key</dt>
                <dd className="font-mono">••••{source.keyHint}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd>
                  {modelCount(source.id)} dinyalakan
                  {source.catalogAt ? ` · katalog ${new Date(source.catalogAt).toLocaleDateString("id-ID")}` : ""}
                </dd>
              </dl>
              {source.lastStatus === "error" && source.lastError && (
                <p className="rounded-lg bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive">{source.lastError}</p>
              )}
              <div className="mt-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => test(source)} disabled={!!busy}>
                  {busy === `test:${source.id}` ? <Spinner /> : <Plug data-icon="inline-start" />}
                  Uji
                </Button>
                <Button size="sm" variant="outline" onClick={() => catalog(source)} disabled={!!busy}>
                  {busy === `catalog:${source.id}` ? <Spinner /> : <ListRestart data-icon="inline-start" />}
                  Muat katalog
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRekey(source)}>
                  <KeyRound data-icon="inline-start" />
                  Ubah
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto text-destructive"
                  onClick={() => setRemoving(source)}
                  aria-label="Hapus sumber"
                  title="Hapus sumber"
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          {adding && (
            <AddSourceForm
              onDone={async () => {
                setAdding(false);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rekey} onOpenChange={(open) => !open && setRekey(null)}>
        <DialogContent className="sm:max-w-lg">
          {rekey && (
            <EditSourceForm
              key={rekey.id}
              source={rekey}
              onDone={async () => {
                setRekey(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Hapus sumber "${removing?.label ?? ""}"?`}
        description="API key-nya dihapus, model dari sumber ini dimatikan dan dilepas dari pembagian tugas. Tidak bisa dibatalkan."
        onConfirm={() => attempt(() => api.removeSource(removing!.id).then(reload), "Sumber dihapus.")}
      />
    </div>
  );
}

function AddSourceForm({ onDone }: { onDone: () => Promise<void> }) {
  const [choice, setChoice] = useState<Choice>("classai");
  const router = ROUTER_PRESETS.find((p) => p.key === choice);
  const [baseUrl, setBaseUrl] = useState(router?.baseUrl ?? "");
  const [apiFormat, setApiFormat] = useState<ApiFormat>("openai");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(next: Choice) {
    setChoice(next);
    setBaseUrl(ROUTER_PRESETS.find((p) => p.key === next)?.baseUrl ?? "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await attempt(
      () =>
        api.createSource(
          router
            ? {
                kind: "router",
                preset: router.key,
                baseUrl: baseUrl.trim(),
                apiFormat,
                apiKey,
                label: label.trim() || undefined,
              }
            : { kind: choice as SourceKind, apiKey, label: label.trim() || undefined },
        ),
      "Sumber ditambahkan. Uji koneksi lalu muat katalognya.",
    );
    setBusy(false);
    if (ok) await onDone();
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Tambah sumber model</DialogTitle>
        <DialogDescription>API key disimpan terenkripsi di Akai dan tidak pernah ditampilkan lagi.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel>Jenis</FieldLabel>
          <Select value={choice} onValueChange={(value) => pick(value as Choice)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Router</SelectLabel>
                {ROUTER_PRESETS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Provider resmi (langsung)</SelectLabel>
                {OFFICIAL.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {router && (
            <FieldDescription>{router.hint} Router pihak ketiga dapat melihat isi permintaan.</FieldDescription>
          )}
        </Field>
        {router && (
          <>
            <Field>
              <FieldLabel htmlFor="src-url">Alamat API</FieldLabel>
              <Input
                id="src-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://router.example.com/v1"
                required
              />
            </Field>
            <Field>
              <FieldLabel>Format</FieldLabel>
              <Select value={apiFormat} onValueChange={(value) => setApiFormat(value as ApiFormat)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI (Chat Completions) — umum</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Messages) — khusus Claude</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="src-label">Nama (opsional)</FieldLabel>
          <Input id="src-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        <Field>
          <FieldLabel htmlFor="src-key">API key</FieldLabel>
          <Input
            id="src-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            minLength={8}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          Simpan
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditSourceForm({ source, onDone }: { source: Source; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState(source.label);
  const [baseUrl, setBaseUrl] = useState(source.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const moved = source.kind === "router" && baseUrl.trim() !== (source.baseUrl ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await attempt(
      () =>
        api.updateSource(source.id, {
          label: label.trim(),
          ...(moved ? { baseUrl: baseUrl.trim() } : {}),
          ...(apiKey ? { apiKey } : {}),
        }),
      "Sumber diperbarui.",
    );
    setBusy(false);
    if (ok) await onDone();
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Ubah sumber</DialogTitle>
        <DialogDescription>
          Kosongkan API key bila tidak diganti. Alamat berubah = API key wajib diisi ulang.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="edit-label">Nama</FieldLabel>
          <Input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        {source.kind === "router" && (
          <Field>
            <FieldLabel htmlFor="edit-url">Alamat API</FieldLabel>
            <Input id="edit-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="edit-key">API key baru</FieldLabel>
          <Input
            id="edit-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`••••${source.keyHint}`}
            required={moved}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          Simpan
        </Button>
      </DialogFooter>
    </form>
  );
}
