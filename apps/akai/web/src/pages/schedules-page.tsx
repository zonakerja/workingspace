import {
  CalendarClock,
  CheckCircle2,
  History,
  Loader2,
  Mail,
  Pencil,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell";
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
import { api, errorText, type Model } from "@/lib/api";
import { type ProjectSummary, projectsApi } from "@/lib/projects";
import {
  DAY_SHORT,
  KIND_LABEL,
  type ScheduleInput,
  type ScheduleKind,
  type ScheduleList,
  type ScheduleRun,
  type ScheduledTask,
  emptySchedule,
  schedulesApi,
  shortWhen,
} from "@/lib/schedules";
import { cn } from "@/lib/utils";

const AUTO = "__auto__";
const NONE = "__none__";

/** Tugas terjadwal Akai (6b.8): perintah yang dijalankan Akai otomatis menurut jadwal; hasil = percakapan baru (+ email). */
export function SchedulesPage() {
  const [state, setState] = useState<ScheduleList | null>(null);
  const [form, setForm] = useState<{ id: string | null; value: ScheduleInput } | null>(null);
  const [history, setHistory] = useState<ScheduledTask | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const { reloadConversations } = useShell();

  useEffect(() => {
    let alive = true;
    schedulesApi
      .list()
      .then((value) => alive && setState(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    api
      .models()
      .then((list) => alive && setModels(list.filter((m) => m.enabled && !m.embedding)))
      .catch(() => undefined);
    projectsApi
      .list()
      .then((list) => alive && setProjects(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setState(await schedulesApi.list());

  // Tugas yang sedang berjalan: muat ulang tiap 3 dtk sampai selesai (hasilnya muncul di sidebar)
  const anyRunning = !!state?.tasks.some((t) => t.running);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      void schedulesApi.list().then((next) => {
        setState(next);
        if (!next.tasks.some((t) => t.running)) void reloadConversations();
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [anyRunning, reloadConversations]);

  async function runNow(task: ScheduledTask) {
    try {
      await schedulesApi.run(task.id);
      toast.success(`"${task.name}" dijalankan. Hasilnya muncul sebagai percakapan baru.`);
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function toggle(task: ScheduledTask, enabled: boolean) {
    try {
      await schedulesApi.update(task.id, { enabled });
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
              <CalendarClock className="size-6" /> Terjadwal
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Perintah yang dijalankan Akai otomatis — mis. rangkum agenda & to-do Akasha tiap pagi, rekap kurs tiap
              Senin. Hasilnya menjadi percakapan baru, dan bisa dikirim ke email Anda.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setForm({ id: null, value: emptySchedule() })}>
            <Plus data-icon="inline-start" /> Buat tugas
          </Button>
        </div>
      </section>

      {!state ? (
        <Spinner className="mx-auto size-6" />
      ) : state.tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          <CalendarClock className="size-7" />
          Belum ada tugas terjadwal.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.tasks.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-2xl border p-4">
              <div className="flex items-start gap-3">
                <Switch
                  className="mt-0.5"
                  checked={t.enabled}
                  aria-label={t.enabled ? "Matikan tugas" : "Nyalakan tugas"}
                  onCheckedChange={(checked) => void toggle(t, checked)}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {t.name}
                    {t.email && (
                      <Badge variant="outline" className="font-normal">
                        <Mail /> Email
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.describe}</p>
                  <p className="mt-1 line-clamp-2 text-xs">{t.prompt}</p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Jalankan sekarang"
                    title="Jalankan sekarang"
                    disabled={t.running}
                    onClick={() => void runNow(t)}
                  >
                    {t.running ? <Loader2 className="animate-spin" /> : <Play />}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Riwayat"
                    title="Riwayat"
                    onClick={() => setHistory(t)}
                  >
                    <History />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Ubah"
                    title="Ubah"
                    onClick={() =>
                      setForm({
                        id: t.id,
                        value: {
                          name: t.name,
                          prompt: t.prompt,
                          schedule: t.schedule,
                          timezone: t.timezone,
                          modelId: t.modelId,
                          projectId: t.projectId,
                          email: t.email,
                          enabled: t.enabled,
                        },
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Hapus"
                    title="Hapus"
                    onClick={() => setDeleting(t)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                <span>Berikutnya: {t.enabled ? shortWhen(t.nextRunAt) : "dimatikan"}</span>
                <span className="flex items-center gap-1">
                  Terakhir: {shortWhen(t.lastRunAt)}
                  {t.lastStatus === "ok" && <CheckCircle2 className="size-3.5 text-success" />}
                  {t.lastStatus === "error" && <TriangleAlert className="size-3.5 text-destructive" />}
                </span>
                <span>{t.runCount}× dijalankan</span>
              </div>
              {t.lastStatus === "error" && t.lastError && (
                <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{t.lastError}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
          {form && state && (
            <TaskForm
              key={form.id ?? "new"}
              id={form.id}
              initial={form.value}
              list={state}
              models={models}
              projects={projects}
              onCancel={() => setForm(null)}
              onSaved={async () => {
                setForm(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent className="grid max-h-[80svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:max-w-md">
          {history && <RunHistory key={history.id} task={history} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus tugas terjadwal?"
        description={`Tugas "${deleting?.name ?? ""}" tidak akan dijalankan lagi. Percakapan hasil yang sudah ada tetap tersimpan.`}
        onConfirm={async () => {
          if (!deleting) return false;
          try {
            await schedulesApi.remove(deleting.id);
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

function TaskForm({
  id,
  initial,
  list,
  models,
  projects,
  onCancel,
  onSaved,
}: {
  id: string | null;
  initial: ScheduleInput;
  list: ScheduleList;
  models: Model[];
  projects: ProjectSummary[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const s = value.schedule;
  const setSchedule = (patch: Partial<ScheduleInput["schedule"]>) =>
    setValue((prev) => ({ ...prev, schedule: { ...prev.schedule, ...patch } }));

  async function save() {
    setBusy(true);
    try {
      if (id) await schedulesApi.update(id, value);
      else await schedulesApi.create(value);
      toast.success("Tugas terjadwal disimpan.");
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
        <DialogTitle>{id ? "Ubah tugas terjadwal" : "Buat tugas terjadwal"}</DialogTitle>
        <DialogDescription>
          Akai menjalankan perintah ini seperti Anda mengetiknya di chat (skill, konektor, dan plugin ikut dipakai).
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto pr-1">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="task-name">Nama</FieldLabel>
            <Input
              id="task-name"
              maxLength={100}
              value={value.name}
              placeholder="Rangkuman pagi"
              onChange={(e) => setValue((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="task-prompt">Perintah</FieldLabel>
            <Textarea
              id="task-prompt"
              rows={4}
              maxLength={8000}
              value={value.prompt}
              placeholder="Rangkum agenda dan to-do saya hari ini dari Akasha, urutkan menurut prioritas."
              onChange={(e) => setValue((prev) => ({ ...prev, prompt: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Jadwal</FieldLabel>
              <Select value={s.kind} onValueChange={(kind) => setSchedule({ kind: kind as ScheduleKind })}>
                <SelectTrigger aria-label="Jenis jadwal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as ScheduleKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="task-time">
                {s.kind === "hourly" ? "Pada menit (jam diabaikan)" : "Pukul"}
              </FieldLabel>
              <Input
                id="task-time"
                type="time"
                value={s.time}
                onChange={(e) => setSchedule({ time: e.target.value })}
              />
            </Field>
          </div>
          {s.kind === "hourly" && (
            <Field>
              <FieldLabel htmlFor="task-every">Setiap berapa jam</FieldLabel>
              <Input
                id="task-every"
                type="number"
                min={1}
                max={24}
                value={s.everyHours}
                onChange={(e) => setSchedule({ everyHours: Number(e.target.value) })}
              />
              <FieldDescription>Dihitung dari tengah malam, mis. 6 = pukul 00, 06, 12, 18.</FieldDescription>
            </Field>
          )}
          {s.kind === "weekly" && (
            <Field>
              <FieldLabel>Hari</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {DAY_SHORT.map((label, day) => {
                  const on = s.days.includes(day);
                  return (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() =>
                        setSchedule({ days: on ? s.days.filter((d) => d !== day) : [...s.days, day].sort() })
                      }
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </Field>
          )}
          {s.kind === "monthly" && (
            <Field>
              <FieldLabel htmlFor="task-dom">Tanggal</FieldLabel>
              <Input
                id="task-dom"
                type="number"
                min={1}
                max={28}
                value={s.dayOfMonth}
                onChange={(e) => setSchedule({ dayOfMonth: Number(e.target.value) })}
              />
              <FieldDescription>1–28 (agar ada di setiap bulan).</FieldDescription>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Zona waktu</FieldLabel>
              <Select value={value.timezone} onValueChange={(timezone) => setValue((prev) => ({ ...prev, timezone }))}>
                <SelectTrigger aria-label="Zona waktu">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.timezones.map((tz) => (
                    <SelectItem key={tz.id} value={tz.id}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Model</FieldLabel>
              <Select
                value={value.modelId ?? AUTO}
                onValueChange={(v) => setValue((prev) => ({ ...prev, modelId: v === AUTO ? null : v }))}
              >
                <SelectTrigger aria-label="Model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Otomatis (tugas Chat)</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {projects.length > 0 && (
            <Field>
              <FieldLabel>Proyek (opsional)</FieldLabel>
              <Select
                value={value.projectId ?? NONE}
                onValueChange={(v) => setValue((prev) => ({ ...prev, projectId: v === NONE ? null : v }))}
              >
                <SelectTrigger aria-label="Proyek">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Tanpa proyek</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Instruksi & pengetahuan proyek ikut dipakai.</FieldDescription>
            </Field>
          )}
          <Field orientation="horizontal">
            <Switch
              id="task-email"
              checked={value.email}
              disabled={!list.emailTo}
              onCheckedChange={(email) => setValue((prev) => ({ ...prev, email }))}
            />
            <div className="flex flex-col gap-0.5">
              <FieldLabel htmlFor="task-email">Kirim hasil ke email</FieldLabel>
              <FieldDescription>
                {list.emailTo
                  ? `${list.emailTo}${list.emailDelivering ? "" : " — email belum aktif di server (pengembangan: ditulis ke folder .mail)"}`
                  : "Akun SSO Anda belum punya email."}
              </FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button onClick={() => void save()} disabled={busy || !value.name.trim() || !value.prompt.trim()}>
          {busy && <Spinner />} Simpan
        </Button>
      </DialogFooter>
    </>
  );
}

function RunHistory({ task }: { task: ScheduledTask }) {
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null);
  useEffect(() => {
    let alive = true;
    schedulesApi
      .runs(task.id)
      .then((list) => alive && setRuns(list))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, [task.id]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Riwayat {task.name}</DialogTitle>
        <DialogDescription>30 hasil terakhir. Klik untuk membuka percakapannya.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto">
        {!runs ? (
          <Spinner className="mx-auto size-5" />
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum pernah dijalankan.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/chat/${r.id}`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent",
                    r.unread && "font-semibold",
                  )}
                >
                  {r.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Belum dibuka" />}
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
