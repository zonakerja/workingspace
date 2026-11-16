import {
  BookOpen,
  Download,
  Eye,
  FileText,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/api";
import {
  SKILL_FILE_ACCEPT,
  SKILL_LIMITS,
  type SkillItem,
  type SkillList,
  downloadText,
  skillSlug,
  skillsApi,
} from "@/lib/skills";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  files: { path: string; content: string }[];
};

const EMPTY: Draft = { id: null, name: "", description: "", instructions: "", files: [] };

const readFiles = (list: FileList | null) =>
  Promise.all([...(list ?? [])].map(async (file) => ({ path: file.name, content: await file.text() })));

/** Skill Akai (6b.6): instruksi khusus (format SKILL.md) yang dimuat Akai otomatis saat permintaan cocok — bawaan & buatan sendiri. */
export function SkillsPage() {
  const [state, setState] = useState<SkillList | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<SkillItem | null>(null);
  const [deleting, setDeleting] = useState<SkillItem | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    skillsApi
      .list()
      .then((value) => alive && setState(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setState(await skillsApi.list());

  async function toggle(skill: SkillItem, enabled: boolean) {
    try {
      if (skill.builtin) setState(await skillsApi.setBuiltin(skill.name, enabled));
      else if (skill.id) {
        await skillsApi.update(skill.id, { enabled });
        await reload();
      }
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function edit(skill: SkillItem) {
    if (!skill.id) return;
    try {
      const detail = await skillsApi.get(skill.id);
      setDraft({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        instructions: detail.instructions,
        files: detail.fileContents,
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function exportSkill(skill: SkillItem) {
    try {
      if (!skill.id) {
        downloadText(
          "SKILL.md",
          `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`,
        );
        return;
      }
      const detail = await skillsApi.get(skill.id);
      downloadText(`${detail.name}-SKILL.md`, detail.skillMd);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  /** Impor folder skill: pilih SKILL.md (+ berkas pendukung sekaligus). */
  async function importSkill(e: ChangeEvent<HTMLInputElement>) {
    const picked = await readFiles(e.target.files);
    e.target.value = "";
    const main = picked.find((f) => f.path.toLowerCase().endsWith("skill.md")) ?? picked[0];
    if (!main) return;
    try {
      const created = await skillsApi.create({
        skillMd: main.content,
        files: picked.filter((f) => f !== main),
      });
      toast.success(`Skill ${created.name} ditambahkan.`);
      await reload();
    } catch (error) {
      toast.error(`Gagal mengimpor: ${errorText(error)}`);
    }
  }

  const row = (skill: SkillItem) => (
    <li key={skill.id ?? skill.name} className="group flex items-start gap-3 px-4 py-3">
      <Switch
        className="mt-0.5"
        checked={skill.enabled}
        aria-label={skill.enabled ? "Matikan skill" : "Nyalakan skill"}
        onCheckedChange={(checked) => void toggle(skill, checked)}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="font-mono">{skill.name}</span>
          {skill.files.length > 0 && (
            <Badge variant="outline" className="font-normal">
              <FileText /> {skill.files.length} berkas
            </Badge>
          )}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
      </div>
      <div className="flex shrink-0 gap-0.5 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        {skill.builtin ? (
          <Button size="icon-xs" variant="ghost" aria-label="Lihat instruksi" onClick={() => setViewing(skill)}>
            <Eye />
          </Button>
        ) : (
          <Button size="icon-xs" variant="ghost" aria-label="Ubah skill" onClick={() => void edit(skill)}>
            <Pencil />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Unduh SKILL.md" onClick={() => void exportSkill(skill)}>
          <Download />
        </Button>
        {!skill.builtin && (
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            aria-label="Hapus skill"
            onClick={() => setDeleting(skill)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-aurora px-5 py-5 text-ink-foreground md:px-7">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display flex items-center gap-2 text-xl font-bold md:text-2xl">
              <Sparkles className="size-6" /> Skill
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Instruksi khusus untuk pekerjaan tertentu — format surat, notulen, telaahan, cara kerja Anda. Akai memuat
              skill yang cocok secara otomatis saat Anda meminta pekerjaan itu.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={importRef}
              type="file"
              multiple
              accept={SKILL_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => void importSkill(e)}
            />
            <Button variant="secondary" onClick={() => importRef.current?.click()}>
              <Upload data-icon="inline-start" /> Impor SKILL.md
            </Button>
            <Button variant="secondary" onClick={() => setDraft({ ...EMPTY })}>
              <Plus data-icon="inline-start" /> Buat skill
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
              <h2 className="text-base font-semibold">Skill saya</h2>
              {state.custom.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  <BookOpen className="size-7" />
                  Belum ada skill buatan Anda. Buat dari awal, atau impor SKILL.md (juga skill Hermes).
                </div>
              ) : (
                <ul className="flex flex-col divide-y rounded-2xl border">{state.custom.map(row)}</ul>
              )}
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Skill bawaan Akai</h2>
              <ul className="flex flex-col divide-y rounded-2xl border">{state.builtin.map(row)}</ul>
            </section>
          </div>

          <aside className="flex flex-col gap-3">
            <section className="flex flex-col gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldCheck className="size-4" /> Cara kerja
              </h2>
              <p>
                Akai hanya melihat nama dan deskripsi skill yang menyala. Bila permintaan Anda cocok dengan deskripsi,
                Akai memuat instruksi lengkapnya (terlihat sebagai "Skill · nama" di atas jawaban) lalu bekerja
                mengikutinya.
              </p>
              <p>
                Tulis <strong>deskripsi</strong> sejelas mungkin: apa yang dikerjakan skill dan kapan dipakai. Itulah
                yang dipakai Akai untuk memutuskan.
              </p>
              <p>
                Format sama dengan skill Hermes: berkas <code>SKILL.md</code> berisi <code>name</code> dan{" "}
                <code>description</code> di bagian atas, lalu instruksi Markdown. Berkas pendukung (contoh, templat)
                dibaca Akai bila instruksi menyebutnya.
              </p>
              <p>
                Model yang tidak mendukung alat tetap bisa memakai skill: Akai memilih skill yang kata kuncinya paling
                cocok dengan pesan Anda.
              </p>
            </section>
          </aside>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
          {draft && (
            <SkillForm
              key={draft.id ?? "new"}
              initial={draft}
              onCancel={() => setDraft(null)}
              onSaved={async () => {
                setDraft(null);
                await reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="grid max-h-[92svh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.description}</DialogDescription>
          </DialogHeader>
          <pre className="min-h-0 overflow-auto rounded-xl bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {viewing?.instructions}
          </pre>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus skill?"
        description={`Skill "${deleting?.name ?? ""}" beserta berkas pendukungnya dihapus permanen. Unduh SKILL.md dulu bila ingin menyimpannya.`}
        onConfirm={async () => {
          if (!deleting?.id) return false;
          try {
            await skillsApi.remove(deleting.id);
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

function SkillForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Draft;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = await readFiles(e.target.files);
    e.target.value = "";
    setForm((prev) => ({
      ...prev,
      files: [...prev.files.filter((f) => !picked.some((p) => p.path === f.path)), ...picked].slice(
        0,
        SKILL_LIMITS.maxFiles,
      ),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const input = {
        name: skillSlug(form.name),
        description: form.description,
        instructions: form.instructions,
        files: form.files,
      };
      if (form.id) await skillsApi.update(form.id, input);
      else await skillsApi.create(input);
      toast.success("Skill disimpan.");
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
        <DialogTitle>{form.id ? "Ubah skill" : "Buat skill"}</DialogTitle>
        <DialogDescription>Akai memuat skill ini saat permintaan Anda cocok dengan deskripsinya.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto pr-1">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="skill-name">Nama</FieldLabel>
            <Input
              id="skill-name"
              value={form.name}
              maxLength={64}
              placeholder="surat-undangan-rapat"
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={() => setForm((prev) => ({ ...prev, name: skillSlug(prev.name) }))}
            />
            <FieldDescription>Huruf kecil, angka, dan tanda hubung.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-description">Deskripsi: apa & kapan dipakai</FieldLabel>
            <Textarea
              id="skill-description"
              rows={2}
              value={form.description}
              maxLength={SKILL_LIMITS.descriptionChars}
              placeholder="Menyusun surat undangan rapat dinas. Pakai saat diminta membuat undangan rapat atau acara kantor."
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-instructions">Instruksi (Markdown)</FieldLabel>
            <Textarea
              id="skill-instructions"
              rows={12}
              className="font-mono text-xs"
              value={form.instructions}
              maxLength={SKILL_LIMITS.instructionsChars}
              placeholder={"# Surat undangan\n\n1. …\n2. …"}
              onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
            />
            <FieldDescription>
              {form.instructions.length.toLocaleString("id-ID")} /{" "}
              {SKILL_LIMITS.instructionsChars.toLocaleString("id-ID")} karakter
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Berkas pendukung (opsional)</FieldLabel>
            {form.files.length > 0 && (
              <ul className="flex flex-col divide-y rounded-xl border text-sm">
                {form.files.map((f) => (
                  <li key={f.path} className="flex items-center gap-2 px-3 py-1.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                    <span className="text-xs text-muted-foreground">
                      {f.content.length.toLocaleString("id-ID")} kar.
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Hapus ${f.path}`}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, files: prev.files.filter((x) => x.path !== f.path) }))
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={SKILL_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => void addFiles(e)}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={form.files.length >= SKILL_LIMITS.maxFiles}
              onClick={() => fileRef.current?.click()}
            >
              <Upload data-icon="inline-start" /> Tambah berkas teks
            </Button>
            <FieldDescription>
              Contoh naskah, templat, daftar istilah. Maks. {SKILL_LIMITS.maxFiles} berkas teks, masing-masing{" "}
              {SKILL_LIMITS.fileChars.toLocaleString("id-ID")} karakter.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button
          onClick={() => void save()}
          disabled={busy || !form.name.trim() || !form.description.trim() || !form.instructions.trim()}
        >
          {busy && <Spinner />} Simpan
        </Button>
      </DialogFooter>
    </>
  );
}
