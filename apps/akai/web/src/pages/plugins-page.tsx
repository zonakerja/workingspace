import {
  BookOpen,
  Code2,
  Download,
  FlaskConical,
  Globe,
  Package,
  Pencil,
  Play,
  Plug,
  Puzzle,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/api";
import {
  type PluginItem,
  type PluginList,
  type PluginTestResult,
  connectorStatusLabel,
  pluginsApi,
  sampleInput,
  toolKind,
} from "@/lib/plugins";
import { downloadText } from "@/lib/skills";

/**
 * Plugin Akai (6b.7): **kode** JavaScript yang menambah alat (dijalankan di sandbox tanpa akses ke server) atau **paket** seperti plugin
 * Claude (instruksi tetap + skill + konektor MCP yang dipasang bersama).
 */
export function PluginsPage() {
  const [state, setState] = useState<PluginList | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; code: string } | null>(null);
  const [setting, setSetting] = useState<PluginItem | null>(null);
  const [testing, setTesting] = useState<PluginItem | null>(null);
  const [deleting, setDeleting] = useState<PluginItem | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    pluginsApi
      .list()
      .then((value) => alive && setState(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setState(await pluginsApi.list());

  async function installCatalog(key: string) {
    setInstalling(key);
    try {
      const p = await pluginsApi.install({ catalogKey: key });
      toast.success(`Plugin ${p.title} terpasang.`);
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setInstalling(null);
    }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setEditing({ id: null, code: await file.text() });
  }

  async function openCode(p: PluginItem) {
    try {
      setEditing({ id: p.id, code: (await pluginsApi.get(p.id)).code });
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function exportCode(p: PluginItem) {
    try {
      downloadText(`${p.name}.${p.kind === "package" ? "json" : "js"}`, (await pluginsApi.get(p.id)).code);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function toggle(p: PluginItem, enabled: boolean) {
    try {
      await pluginsApi.update(p.id, { enabled });
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-aurora px-5 py-5 text-ink-foreground md:px-7">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display flex items-center gap-2 text-xl font-bold md:text-2xl">
              <Puzzle className="size-6" /> Plugin
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Tambahkan kemampuan baru untuk Akai: <strong>paket</strong> (instruksi kerja + skill + konektor aplikasi,
              seperti plugin Claude) atau <strong>kode</strong> JavaScript untuk alat sendiri yang berjalan di sandbox.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept=".js,.mjs,.json,.txt"
              className="hidden"
              onChange={(e) => void upload(e)}
            />
            <Button variant="secondary" onClick={() => uploadRef.current?.click()}>
              <Upload data-icon="inline-start" /> Unggah berkas
            </Button>
            <Button
              variant="secondary"
              disabled={!state}
              onClick={() => state && setEditing({ id: null, code: state.packageTemplate })}
            >
              <Package data-icon="inline-start" /> Buat paket
            </Button>
            <Button
              variant="secondary"
              disabled={!state}
              onClick={() => state && setEditing({ id: null, code: state.template })}
            >
              <Code2 data-icon="inline-start" /> Tulis kode
            </Button>
          </div>
        </div>
      </section>

      {!state ? (
        <Spinner className="mx-auto size-6" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Plugin terpasang</h2>
              {state.plugins.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  <Puzzle className="size-7" />
                  Belum ada plugin. Pasang contoh di bawah, buat paket / tulis kode sendiri, atau unggah berkas .json /
                  .js.
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {state.plugins.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 rounded-2xl border p-4">
                      <div className="flex items-start gap-3">
                        <Switch
                          className="mt-0.5"
                          checked={p.enabled}
                          aria-label={p.enabled ? "Matikan plugin" : "Nyalakan plugin"}
                          onCheckedChange={(checked) => void toggle(p, checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {p.title}
                            <Badge variant="outline" className="font-normal">
                              {p.kind === "package" ? <Package /> : <Code2 />}
                              {p.kind === "package" ? "Paket" : "Kode"}
                            </Badge>
                            <span className="font-mono text-xs font-normal text-muted-foreground">
                              {p.name} · v{p.version}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                          {p.kind === "code" && (
                            <>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Uji alat"
                                title="Uji alat"
                                onClick={() => setTesting(p)}
                              >
                                <FlaskConical />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Pengaturan"
                                title="Pengaturan"
                                onClick={() => setSetting(p)}
                              >
                                <Settings2 />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={p.kind === "package" ? "Ubah isi paket" : "Ubah kode"}
                            title={p.kind === "package" ? "Ubah isi paket" : "Ubah kode"}
                            onClick={() => void openCode(p)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={p.kind === "package" ? "Unduh .json" : "Unduh .js"}
                            title={p.kind === "package" ? "Unduh .json" : "Unduh .js"}
                            onClick={() => void exportCode(p)}
                          >
                            <Download />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label="Hapus plugin"
                            title="Hapus plugin"
                            onClick={() => setDeleting(p)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      {p.missingConfig.length > 0 && (
                        <p className="flex items-center gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs text-foreground">
                          <TriangleAlert className="size-3.5 shrink-0 text-warning" />
                          Belum dipakai Akai: lengkapi pengaturan ({p.missingConfig.join(", ")}).
                        </p>
                      )}
                      {p.kind === "package" ? (
                        <PackageDetails plugin={p} />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {p.hosts.length > 0 ? (
                              p.hosts.map((h) => (
                                <Badge key={h} variant="outline" className="font-normal">
                                  <Globe /> {h}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground">Tanpa akses jaringan</span>
                            )}
                          </div>
                          <ul className="flex flex-col gap-1 border-t pt-2 text-xs">
                            {p.tools.map((t) => (
                              <li key={t.name} className="flex items-start gap-2">
                                <Badge variant={t.usable ? "secondary" : "outline"} className="shrink-0 font-normal">
                                  {toolKind(t)}
                                </Badge>
                                <span className="min-w-0">
                                  <span className="font-mono">{t.name}</span>{" "}
                                  <span className="text-muted-foreground">— {t.description}</span>
                                  {!t.usable && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      (
                                      {t.destructive
                                        ? "tidak pernah dipakai di chat"
                                        : "nyalakan izin ubah di Pengaturan"}
                                      )
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                            {p.skills.length > 0 && (
                              <li className="text-muted-foreground">
                                Skill bawaan: {p.skills.map((s) => s.name).join(", ")}
                              </li>
                            )}
                          </ul>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Contoh plugin</h2>
              <ul className="flex flex-col divide-y rounded-2xl border">
                {state.catalog.map((c) => (
                  <li key={c.key} className="flex items-center gap-3 px-4 py-3">
                    {c.kind === "package" ? (
                      <Package className="size-5 shrink-0 text-primary" />
                    ) : (
                      <Code2 className="size-5 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={c.installed || installing === c.key}
                      onClick={() => void installCatalog(c.key)}
                    >
                      {installing === c.key && <Spinner />} {c.installed ? "Terpasang" : "Pasang"}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="flex flex-col gap-3">
            <section className="flex flex-col gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldCheck className="size-4" /> Keamanan
              </h2>
              <p>
                Kode plugin berjalan di <strong>sandbox</strong> (mesin JavaScript terpisah): tidak bisa membaca berkas,
                database, atau memanggil server Akai. Waktu (30 detik) dan memori dibatasi.
              </p>
              <p>
                Akses jaringan hanya ke <strong>host yang tertulis</strong> di plugin (https, bukan jaringan lokal).
                Data yang dikirim alat ke host itu keluar dari Akai — pasang hanya plugin yang kodenya Anda percaya.
              </p>
              <p>
                Seperti konektor: alat <em>Baca</em> selalu dipakai, alat <em>Ubah</em> hanya bila Anda izinkan, alat
                bertanda <em>Hapus</em> tidak pernah dipakai di chat. Nilai pengaturan rahasia disimpan terenkripsi.
              </p>
            </section>
            <section className="flex flex-col gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Code2 className="size-4" /> Menulis plugin
              </h2>
              <p>
                Panggil <code>definePlugin(&#123; name, description, hosts, config, tools &#125;)</code>. Setiap alat
                punya <code>run: async (input, akai) =&gt; …</code>.
              </p>
              <p>
                <code>akai.fetch(url, init)</code> → <code>&#123; status, ok, json(), text() &#125;</code>,{" "}
                <code>akai.config</code> = nilai pengaturan, <code>akai.log()</code> = catatan saat uji.
              </p>
              <p>
                Plugin juga boleh membawa <code>skills</code> (nama, deskripsi, instruksi) yang otomatis tampil di menu
                Skill. Mulai dari tombol <strong>Tulis kode</strong>.
              </p>
            </section>
            <section className="flex flex-col gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Package className="size-4" /> Paket
              </h2>
              <p>
                Paket = satu berkas JSON berisi <code>"type": "akai-package"</code>, <code>instructions</code>{" "}
                (instruksi kerja tetap), <code>skills</code> (boleh dengan berkas), dan <code>connectors</code> (server
                MCP / preset <code>akasha</code>). Paket tidak menjalankan kode.
              </p>
              <p>
                Konektor paket dibuat saat paket dipasang. <strong>Token tidak pernah ditulis di berkas paket</strong>:
                isi di halaman Konektor. Mematikan paket ikut mematikan konektornya; menghapus paket ikut menghapusnya.
              </p>
            </section>
          </aside>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl">
          {editing && (
            <CodeForm
              key={editing.id ?? "new"}
              initial={editing}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!setting} onOpenChange={(open) => !open && setSetting(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
          {setting && (
            <SettingsForm
              key={setting.id}
              plugin={setting}
              onCancel={() => setSetting(null)}
              onSaved={async () => {
                setSetting(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!testing} onOpenChange={(open) => !open && setTesting(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
          {testing && <TestPanel key={testing.id} plugin={testing} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus plugin?"
        description={
          deleting?.kind === "package"
            ? `Paket "${deleting.title}" beserta skill dan ${deleting.connectors.length} konektornya dihapus permanen (token yang tersimpan ikut terhapus). Unduh .json dulu bila ingin menyimpannya.`
            : `Plugin "${deleting?.title ?? ""}" beserta pengaturannya dihapus permanen. Unduh .js dulu bila ingin menyimpan kodenya.`
        }
        onConfirm={async () => {
          if (!deleting) return false;
          try {
            await pluginsApi.remove(deleting.id);
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

function CodeForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: { id: string | null; code: string };
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState(initial.code);
  const [busy, setBusy] = useState(false);
  const isPackage = code.trimStart().startsWith("{");

  async function save() {
    setBusy(true);
    try {
      const p = initial.id ? await pluginsApi.update(initial.id, { code }) : await pluginsApi.install({ code });
      toast.success(
        p.kind === "package"
          ? `Paket ${p.title} disimpan: ${p.skills.length} skill, ${p.connectors.length} konektor.`
          : `Plugin ${p.title} disimpan: ${p.tools.length} alat.`,
      );
      await onSaved();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {initial.id ? (isPackage ? "Ubah paket" : "Ubah kode plugin") : isPackage ? "Pasang paket" : "Pasang plugin"}
        </DialogTitle>
        <DialogDescription>
          {isPackage ? (
            <>
              Paket JSON diperiksa saat disimpan (tanpa menjalankan kode). Konektor yang dibawa dibuat otomatis; isi
              tokennya di halaman Konektor.
            </>
          ) : (
            <>
              Kode diperiksa di sandbox saat disimpan: <code>definePlugin</code> wajib dipanggil dan setiap alat wajib
              punya <code>run</code>.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <Textarea
        aria-label="Kode plugin"
        spellCheck={false}
        className="min-h-[50svh] resize-none font-mono text-xs leading-relaxed"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = el;
            setCode(`${code.slice(0, s)}  ${code.slice(end)}`);
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          }
        }}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button onClick={() => void save()} disabled={busy || !code.trim()}>
          {busy && <Spinner />} {initial.id ? "Simpan" : "Pasang"}
        </Button>
      </DialogFooter>
    </>
  );
}

function SettingsForm({
  plugin,
  onCancel,
  onSaved,
}: {
  plugin: PluginItem;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(plugin.config);
  const [allowWrite, setAllowWrite] = useState(plugin.allowWrite);
  const [busy, setBusy] = useState(false);
  const hasWriteTools = plugin.tools.some((t) => !t.readOnly && !t.destructive);

  async function save() {
    setBusy(true);
    try {
      await pluginsApi.update(plugin.id, { config: values, allowWrite });
      toast.success("Pengaturan plugin disimpan.");
      await onSaved();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Pengaturan {plugin.title}</DialogTitle>
        <DialogDescription>Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto pr-1">
        <FieldGroup>
          {plugin.configFields.length === 0 && (
            <p className="text-sm text-muted-foreground">Plugin ini tidak punya isian pengaturan.</p>
          )}
          {plugin.configFields.map((f) => (
            <Field key={f.key}>
              <FieldLabel htmlFor={`cfg-${f.key}`}>
                {f.label}
                {f.required && <span className="text-destructive">*</span>}
              </FieldLabel>
              <Input
                id={`cfg-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={values[f.key] ?? ""}
                placeholder={f.secret && values[f.key] ? "Tersimpan — ketik untuk mengganti" : undefined}
                onFocus={() => {
                  if (f.secret && values[f.key] === "••••••") setValues((prev) => ({ ...prev, [f.key]: "" }));
                }}
                onBlur={() => {
                  if (f.secret && !values[f.key] && plugin.config[f.key])
                    setValues((prev) => ({ ...prev, [f.key]: plugin.config[f.key] }));
                }}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
              {f.description && <FieldDescription>{f.description}</FieldDescription>}
            </Field>
          ))}
          {hasWriteTools && (
            <Field orientation="horizontal">
              <Switch id="plugin-write" checked={allowWrite} onCheckedChange={setAllowWrite} />
              <FieldLabel htmlFor="plugin-write">Izinkan alat yang mengubah data dipakai Akai di chat</FieldLabel>
            </Field>
          )}
        </FieldGroup>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner />} Simpan
        </Button>
      </DialogFooter>
    </>
  );
}

function TestPanel({ plugin }: { plugin: PluginItem }) {
  const [tool, setTool] = useState(plugin.tools[0]?.name ?? "");
  const [input, setInput] = useState(() => sampleInput(plugin.tools[0]?.input ?? {}));
  const [result, setResult] = useState<PluginTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const current = plugin.tools.find((t) => t.name === tool);

  async function run() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(input || "{}") as Record<string, unknown>;
    } catch {
      toast.error("Masukan harus JSON yang sah.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      setResult(await pluginsApi.test(plugin.id, tool, parsed));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Uji {plugin.title}</DialogTitle>
        <DialogDescription>
          Jalankan satu alat dengan masukan JSON, seperti yang dilakukan Akai di chat.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <Select
          value={tool}
          onValueChange={(value) => {
            setTool(value);
            setInput(sampleInput(plugin.tools.find((t) => t.name === value)?.input ?? {}));
            setResult(null);
          }}
        >
          <SelectTrigger aria-label="Alat">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plugin.tools.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && <p className="text-xs text-muted-foreground">{current.description}</p>}
        <Textarea
          aria-label="Masukan JSON"
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button className="w-fit" onClick={() => void run()} disabled={busy || !tool}>
          {busy ? <Spinner /> : <Play data-icon="inline-start" />} Jalankan
        </Button>
        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {result.isError ? "Gagal" : "Berhasil"} · {result.ms} md
            </p>
            <pre
              className={`max-h-72 overflow-auto rounded-xl p-3 font-mono text-xs whitespace-pre-wrap ${result.isError ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
            >
              {result.text}
            </pre>
            {result.logs.length > 0 && (
              <>
                <p className="text-xs font-medium">Catatan (akai.log)</p>
                <pre className="max-h-40 overflow-auto rounded-xl bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                  {result.logs.join("\n")}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Isi paket di kartu plugin: instruksi tetap, skill, dan konektor bawaan beserta statusnya. */
function PackageDetails({ plugin }: { plugin: PluginItem }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-2 text-xs">
      {plugin.instructions && (
        <details className="rounded-lg bg-muted/50 px-2.5 py-1.5">
          <summary className="cursor-pointer font-medium">Instruksi kerja</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{plugin.instructions}</p>
        </details>
      )}
      {plugin.skills.length > 0 && (
        <ul className="flex flex-col gap-1">
          {plugin.skills.map((s) => (
            <li key={s.name} className="flex items-start gap-2">
              <Badge variant="secondary" className="shrink-0 font-normal">
                <BookOpen /> Skill
              </Badge>
              <span className="min-w-0">
                <span className="font-mono">
                  {plugin.name}-{s.name}
                </span>{" "}
                <span className="text-muted-foreground">— {s.description}</span>
                {s.files > 0 && <span className="text-muted-foreground"> ({s.files} berkas)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {plugin.connectors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {plugin.connectors.map((c) => {
            const label = connectorStatusLabel(c);
            const ok = label === "Tersambung";
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="shrink-0 font-normal">
                  <Plug /> Konektor
                </Badge>
                <span className="font-medium">{c.name}</span>
                <Badge variant={ok ? "outline" : "destructive"} className="font-normal">
                  {label}
                  {ok && c.tools > 0 ? ` · ${c.tools} alat` : ""}
                </Badge>
                {!ok && c.enabled && (
                  <Link to="/connectors" className="text-primary underline underline-offset-2">
                    {c.hasToken ? "Periksa di Konektor" : "Isi token di Konektor"}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
