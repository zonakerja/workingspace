import { FileText, FolderKanban, MessagesSquare, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/api";
import { type ProjectSummary, projectsApi } from "@/lib/projects";

/** Daftar Proyek Akai (6b.2): kumpulan percakapan + instruksi + berkas pengetahuan. */
export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    projectsApi
      .list()
      .then((value) => alive && setProjects(value))
      .catch((error: unknown) => {
        if (!alive) return;
        toast.error(errorText(error));
        setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-aurora px-5 py-5 text-ink-foreground md:px-7">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold md:text-2xl">Proyek</h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Kumpulkan percakapan untuk satu pekerjaan, beri instruksi tetap, dan unggah dokumen yang selalu dibaca
              Akai saat menjawab di proyek itu.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> Proyek baru
          </Button>
        </div>
      </section>

      {!projects ? (
        <Spinner className="mx-auto size-6" />
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <FolderKanban className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Belum ada proyek. Buat proyek pertama Anda.</p>
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> Proyek baru
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
            >
              <span className="flex items-center gap-2 font-semibold">
                <FolderKanban className="size-4 shrink-0 text-primary" />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {p.description || "Tanpa deskripsi"}
              </span>
              <span className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessagesSquare className="size-3.5" /> {p.conversations} percakapan
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="size-3.5" /> {p.files} berkas
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          {creating && (
            <CreateProjectForm
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                navigate(`/projects/${id}`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateProjectForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await projectsApi.create({ name, description });
      onCreated(project.id);
    } catch (error) {
      toast.error(errorText(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Proyek baru</DialogTitle>
        <DialogDescription>Instruksi dan dokumen pengetahuan bisa ditambahkan setelah proyek dibuat.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="project-name">Nama proyek</FieldLabel>
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Penetapan Status Penggunaan BMN"
            maxLength={120}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-description">Deskripsi (opsional)</FieldLabel>
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Untuk apa proyek ini?"
            maxLength={1000}
            rows={3}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Spinner />} Buat proyek
        </Button>
      </DialogFooter>
    </form>
  );
}
