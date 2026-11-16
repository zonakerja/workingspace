import { Cpu, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatPrice, matchesQuery } from "@/lib/akai-logic";
import { type CatalogEntry, type Model, type ModelCaps, type ModelInput, api } from "@/lib/api";
import { type SettingsData, attempt } from "@/lib/use-settings";
import { ConfirmDialog } from "./confirm-dialog";

const CAPS: { key: keyof ModelCaps; label: string }[] = [
  { key: "vision", label: "Gambar" },
  { key: "pdf", label: "PDF" },
  { key: "tools", label: "Alat" },
  { key: "embedding", label: "Embedding" },
  { key: "audio", label: "Audio" },
];

function CapBadges({ model }: { model: ModelCaps & { packaged?: boolean } }) {
  return (
    <span className="flex flex-wrap gap-1">
      {CAPS.filter((c) => model[c.key]).map((c) => (
        <Badge key={c.key} variant="secondary" className="text-[11px]">
          {c.label}
        </Badge>
      ))}
      {model.packaged && <Badge className="bg-lime/25 text-[11px] text-foreground">Paket</Badge>}
    </span>
  );
}

/** Tab Model: model yang dinyalakan (dipakai pembagian tugas), kemampuan & harga bisa diubah. */
export function ModelsTab({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [removing, setRemoving] = useState<Model | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Hanya model yang dinyalakan yang bisa dipilih di Pembagian tugas. Harga per 1 juta token (masuk / keluar).
        </p>
        <Button onClick={() => setAdding(true)} disabled={data.sources.length === 0}>
          <Plus data-icon="inline-start" />
          Nyalakan model
        </Button>
      </div>

      {data.models.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
          <Cpu className="size-8 text-muted-foreground" />
          <p className="font-medium">Belum ada model</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {data.sources.length === 0
              ? "Tambahkan sumber dulu di tab Sumber."
              : "Pilih model dari katalog sumber, atau ketik ID model sesuai dokumentasi router."}
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {data.models.map((model) => (
            <li key={model.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className={`truncate font-medium ${model.enabled ? "" : "text-muted-foreground line-through"}`}>
                  {model.label}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={model.modelId}>
                  {model.modelId} · {model.source.label}
                </p>
              </div>
              <CapBadges model={model} />
              <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                {formatPrice(model.priceIn, model.priceOut, model.currency)}
              </span>
              <span className="flex items-center gap-1">
                <Switch
                  checked={model.enabled}
                  aria-label={model.enabled ? "Matikan model" : "Nyalakan model"}
                  onCheckedChange={(enabled) => attempt(() => api.updateModel(model.id, { enabled }).then(reload))}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setEditing(model)}
                  aria-label="Ubah model"
                  title="Ubah"
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setRemoving(model)}
                  aria-label="Hapus model"
                  title="Hapus"
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="grid-cols-1 sm:max-w-2xl">
          {adding && (
            <AddModelForm
              data={data}
              onDone={async () => {
                setAdding(false);
                await reload();
              }}
              onAdded={reload}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <EditModelForm
              key={editing.id}
              model={editing}
              onDone={async () => {
                setEditing(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Hapus model "${removing?.label ?? ""}"?`}
        description="Model dilepas dari pembagian tugas. Bisa dinyalakan lagi dari katalog."
        onConfirm={() => attempt(() => api.removeModel(removing!.id).then(reload), "Model dihapus.")}
      />
    </div>
  );
}

function AddModelForm({
  data,
  onDone,
  onAdded,
}: {
  data: SettingsData;
  onDone: () => Promise<void>;
  onAdded: () => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(data.sources[0]?.id ?? "");
  const [loaded, setLoaded] = useState<{ sourceId: string; rows: CatalogEntry[] } | null>(null);
  const catalog = loaded?.sourceId === sourceId ? loaded.rows : null;
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    api
      .catalog(sourceId)
      .then((rows) => alive && setLoaded({ sourceId, rows }))
      .catch(() => alive && setLoaded({ sourceId, rows: [] }));
    return () => {
      alive = false;
    };
  }, [sourceId]);

  const enabledIds = new Set(data.models.filter((m) => m.sourceId === sourceId).map((m) => m.modelId));
  const shown = (catalog ?? []).filter((e) => matchesQuery(`${e.modelId} ${e.name}`, query)).slice(0, 100);

  async function add(modelId: string) {
    setBusy(modelId);
    const ok = await attempt(() => api.addModel({ sourceId, modelId }), `${modelId} dinyalakan.`);
    setBusy(null);
    if (ok) {
      setAdded((prev) => new Set(prev).add(modelId));
      await onAdded();
    }
  }

  async function addManual(event: FormEvent) {
    event.preventDefault();
    if (!manual.trim()) return;
    await add(manual.trim());
    setManual("");
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nyalakan model</DialogTitle>
        <DialogDescription>
          Pilih dari katalog (tombol Muat katalog di tab Sumber), atau ketik ID model sendiri.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari model…"
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-[min(22rem,50svh)] min-h-24 overflow-y-auto rounded-xl border">
          {catalog === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : catalog.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Katalog kosong. Klik Muat katalog di tab Sumber, atau ketik ID di bawah.
            </p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Tidak ada yang cocok.</p>
          ) : (
            <ul className="divide-y">
              {shown.map((entry) => {
                const on = enabledIds.has(entry.modelId) || added.has(entry.modelId);
                return (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{entry.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{entry.modelId}</p>
                    </div>
                    <CapBadges model={{ ...entry, pdf: false, audio: false }} />
                    <span className="hidden w-24 text-right text-xs text-muted-foreground tabular-nums sm:block">
                      {formatPrice(entry.priceIn, entry.priceOut, entry.currency)}
                    </span>
                    <Button
                      size="sm"
                      variant={on ? "ghost" : "outline"}
                      disabled={on || !!busy}
                      onClick={() => add(entry.modelId)}
                    >
                      {busy === entry.modelId && <Spinner />}
                      {on ? "Menyala" : "Nyalakan"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <form onSubmit={addManual} className="flex gap-2">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="ID model, mis. claude-opus-5-5"
            maxLength={200}
          />
          <Button type="submit" variant="outline" disabled={!manual.trim() || !!busy}>
            Tambah ID
          </Button>
        </form>
      </div>
      <DialogFooter>
        <Button onClick={() => void onDone()}>Selesai</Button>
      </DialogFooter>
    </>
  );
}

const toNumber = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

function EditModelForm({ model, onDone }: { model: Model; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState(model.label);
  const [caps, setCaps] = useState<ModelCaps>({
    vision: model.vision,
    pdf: model.pdf,
    tools: model.tools,
    embedding: model.embedding,
    audio: model.audio,
  });
  const [packaged, setPackaged] = useState(model.packaged);
  const [priceIn, setPriceIn] = useState(model.priceIn?.toString() ?? "");
  const [priceOut, setPriceOut] = useState(model.priceOut?.toString() ?? "");
  const [currency, setCurrency] = useState(model.currency ?? "USD");
  const [context, setContext] = useState(model.contextLength?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: ModelInput = {
      label: label.trim(),
      ...caps,
      packaged,
      priceIn: toNumber(priceIn),
      priceOut: toNumber(priceOut),
      currency: currency.trim().toUpperCase() || null,
      contextLength: toNumber(context),
    };
    setBusy(true);
    const ok = await attempt(() => api.updateModel(model.id, body), "Model diperbarui.");
    setBusy(false);
    if (ok) await onDone();
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Ubah model</DialogTitle>
        <DialogDescription className="font-mono break-all">{model.modelId}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="m-label">Nama tampilan</FieldLabel>
          <Input id="m-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        </Field>
        <Field>
          <FieldLabel>Kemampuan</FieldLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CAPS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <Switch checked={caps[c.key]} onCheckedChange={(on) => setCaps((prev) => ({ ...prev, [c.key]: on }))} />
                {c.label}
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
              <Switch checked={packaged} onCheckedChange={setPackaged} />
              Paket
            </label>
          </div>
          <FieldDescription>Paket = token dari paket (mis. Classai), biaya per token dihitung 0.</FieldDescription>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field>
            <FieldLabel htmlFor="m-in">Harga masuk</FieldLabel>
            <Input id="m-in" inputMode="decimal" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-out">Harga keluar</FieldLabel>
            <Input id="m-out" inputMode="decimal" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-cur">Mata uang</FieldLabel>
            <Input id="m-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="m-ctx">Konteks (token)</FieldLabel>
          <Input id="m-ctx" inputMode="numeric" value={context} onChange={(e) => setContext(e.target.value)} />
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
