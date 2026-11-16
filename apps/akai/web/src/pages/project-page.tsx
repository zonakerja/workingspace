import {
  ArrowLeft,
  ArrowUp,
  FileText,
  FolderKanban,
  Info,
  Loader2,
  MessagesSquare,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/api";
import { chatApi, formatSize } from "@/lib/chat";
import { FULL_KNOWLEDGE_CHARS, PROJECT_MAX_CHARS, type Project, formatChars, projectsApi } from "@/lib/projects";
import { cn } from "@/lib/utils";

/** Detail Proyek (6b.2): mulai percakapan di proyek, daftar percakapan, instruksi tetap, pengetahuan proyek. */
export function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { reloadConversations } = useShell();
  const [project, setProject] = useState<Project | null>(null);
  const [instructions, setInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const value = await projectsApi.get(id);
      setProject(value);
      setInstructions(value.instructions);
    } catch (error) {
      toast.error(errorText(error));
      navigate("/projects", { replace: true });
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    projectsApi
      .get(id)
      .then((value) => {
        if (!alive) return;
        setProject(value);
        setInstructions(value.instructions);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        toast.error(errorText(error));
        navigate("/projects", { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  if (!project || project.id !== id) return <Spinner className="mx-auto mt-10 size-6" />;

  const totalChars = project.files.reduce((n, f) => n + f.chars, 0);
  const partial = totalChars > FULL_KNOWLEDGE_CHARS;

  async function start(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || !project) return;
    setStarting(true);
    try {
      const conversation = await chatApi.create(null, project.id);
      void reloadConversations();
      navigate(`/chat/${conversation.id}`, { state: { initial: text } });
    } catch (error) {
      toast.error(errorText(error));
      setStarting(false);
    }
  }

  async function saveInstructions() {
    if (!project) return;
    setSavingInstructions(true);
    try {
      await projectsApi.update(project.id, { instructions });
      setProject({ ...project, instructions });
      toast.success("Instruksi proyek disimpan.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSavingInstructions(false);
    }
  }

  async function saveHeader(e: FormEvent) {
    e.preventDefault();
    if (!project || !editing) return;
    try {
      const updated = await projectsApi.update(project.id, editing);
      setProject({ ...project, name: updated.name, description: updated.description });
      setEditing(null);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function upload(list: FileList) {
    if (!project) return;
    for (const file of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const saved = await projectsApi.addFile(project.id, file);
        if (saved.truncated)
          toast.warning(`${file.name}: terlalu panjang, hanya 500 rb karakter pertama yang dipakai.`);
      } catch (error) {
        toast.error(`${file.name}: ${errorText(error)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
  }

  async function removeFile(fileId: string) {
    if (!project) return;
    try {
      await projectsApi.removeFile(project.id, fileId);
      await load();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const dirty = instructions !== project.instructions;
  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/projects"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Semua proyek
      </Link>

      {editing ? (
        <form onSubmit={saveHeader} className="flex flex-col gap-2 rounded-2xl border p-4">
          <Input
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            maxLength={120}
          />
          <Textarea
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            maxLength={1000}
            rows={2}
            placeholder="Deskripsi proyek"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={!editing.name.trim()}>
              Simpan
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              <FolderKanban className="size-6 shrink-0 text-primary" />
              <span className="truncate">{project.name}</span>
            </h1>
            {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing({ name: project.name, description: project.description })}
            >
              <Pencil data-icon="inline-start" /> Ubah
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 data-icon="inline-start" /> Hapus
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <form
            onSubmit={start}
            className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30"
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="Mulai percakapan baru di proyek ini…"
              className="field-sizing-content max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" size="icon-sm" disabled={starting || !question.trim()} aria-label="Mulai">
              {starting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </form>

          <section className="flex flex-col gap-1">
            <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <MessagesSquare className="size-4" /> Percakapan ({project.conversations.length})
            </h2>
            {project.conversations.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">Belum ada percakapan di proyek ini.</p>
            ) : (
              <div className="flex flex-col divide-y rounded-2xl border">
                {project.conversations.map((c) => (
                  <Link
                    key={c.id}
                    to={`/chat/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent"
                  >
                    <span className="truncate text-sm">{c.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(c.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-2xl border p-4">
            <h2 className="text-sm font-semibold">Instruksi proyek</h2>
            <p className="text-xs text-muted-foreground">
              Dipakai Akai di setiap percakapan proyek ini, mis. peran, gaya bahasa, format jawaban, istilah instansi.
            </p>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              maxLength={20_000}
              placeholder="mis. Anda membantu verifikator BMN. Jawab formal, rujuk pasal PMK yang relevan, dan beri tabel ringkasan."
            />
            <Button
              size="sm"
              className="self-end"
              onClick={() => void saveInstructions()}
              disabled={!dirty || savingInstructions}
            >
              {savingInstructions && <Spinner />} Simpan instruksi
            </Button>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Pengetahuan proyek</h2>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
                {uploading > 0 ? <Spinner /> : <Upload data-icon="inline-start" />} Unggah
              </Button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept=".pdf,.docx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.html,application/pdf,text/*"
                onChange={(e) => {
                  if (e.target.files) void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              PDF berteks, DOCX, atau berkas teks (maks. 20 MB per berkas).
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", partial ? "bg-warning" : "bg-primary")}
                style={{ width: `${Math.min(100, (totalChars / PROJECT_MAX_CHARS) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {formatChars(totalChars)} dari {formatChars(PROJECT_MAX_CHARS)} karakter
            </p>
            {partial && (
              <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-2 text-[11px] text-warning">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Pengetahuan lebih dari {formatChars(FULL_KNOWLEDGE_CHARS)} karakter: Akai membaca bagian yang paling
                relevan dengan setiap pertanyaan, bukan seluruh dokumen.
              </p>
            )}
            {project.files.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">Belum ada berkas.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {project.files.map((f) => (
                  <li key={f.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" title={f.name}>
                        {f.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatSize(f.size)} · {formatChars(f.chars)} karakter
                      </span>
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="text-destructive pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                      aria-label={`Hapus ${f.name}`}
                      onClick={() => void removeFile(f.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Hapus proyek?"
        description={`"${project.name}" beserta instruksi dan berkas pengetahuannya dihapus permanen. Percakapan tetap ada, keluar dari proyek.`}
        onConfirm={async () => {
          try {
            await projectsApi.remove(project.id);
            void reloadConversations();
            navigate("/projects");
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
