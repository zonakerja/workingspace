import { Brain, Check, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/api";
import { type MemoryItem, type MemoryState, memoryApi } from "@/lib/memory";

/** Memori Akai (6b.3): yang diingat Akai tentang pengguna lintas percakapan — lihat, tambah, ubah, hapus, matikan. */
export function MemoryPage() {
  const [state, setState] = useState<MemoryState | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    memoryApi
      .list()
      .then((value) => alive && setState(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setState(await memoryApi.list());

  async function toggle(enabled: boolean) {
    try {
      setState(await memoryApi.setEnabled(enabled));
      toast.success(enabled ? "Memori dinyalakan." : "Memori dimatikan: Akai tidak mencatat dan tidak memakai memori.");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await memoryApi.add(draft);
      setDraft("");
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing) return;
    try {
      await memoryApi.update(editing.id, editing.content);
      setEditing(null);
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function remove(item: MemoryItem) {
    try {
      await memoryApi.remove(item.id);
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
              <Brain className="size-6" /> Memori
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Fakta tentang Anda yang diingat Akai di semua percakapan — peran, tempat kerja, pekerjaan yang berjalan,
              gaya jawaban yang Anda sukai. Akai mencatatnya sendiri dari percakapan, atau Anda tambahkan di sini.
            </p>
          </div>
          {state && (
            <label className="flex items-center gap-2 rounded-xl bg-black/15 px-3 py-2 text-sm font-medium">
              <Switch checked={state.enabled} onCheckedChange={(checked) => void toggle(checked)} />
              {state.enabled ? "Memori menyala" : "Memori mati"}
            </label>
          )}
        </div>
      </section>

      {!state ? (
        <Spinner className="mx-auto size-6" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <form onSubmit={add} className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={300}
                placeholder="Tambah memori, mis. Saya verifikator BMN di KPKNL Malang"
              />
              <Button type="submit" disabled={busy || !draft.trim()}>
                {busy ? <Spinner /> : <Plus data-icon="inline-start" />} Tambah
              </Button>
            </form>

            {state.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                <Brain className="size-7" />
                Belum ada memori.{" "}
                {state.enabled ? "Akai akan mencatat saat Anda bercerita tentang diri atau pekerjaan Anda." : ""}
              </div>
            ) : (
              <ul className="flex flex-col divide-y rounded-2xl border">
                {state.items.map((item) =>
                  editing?.id === item.id ? (
                    <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                      <Input
                        autoFocus
                        value={editing.content}
                        maxLength={300}
                        onChange={(e) => setEditing({ id: item.id, content: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button size="icon-sm" variant="ghost" aria-label="Simpan" onClick={() => void save()}>
                        <Check />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Batal" onClick={() => setEditing(null)}>
                        <X />
                      </Button>
                    </li>
                  ) : (
                    <li key={item.id} className="group flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{item.content}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="outline" className="font-normal">
                            {item.source === "auto" ? "Dicatat Akai" : "Ditambah Anda"}
                          </Badge>
                          {new Date(item.updatedAt).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          {item.conversationId && (
                            <Link to={`/chat/${item.conversationId}`} className="underline underline-offset-2">
                              dari percakapan
                            </Link>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-0.5 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Ubah memori"
                          onClick={() => setEditing({ id: item.id, content: item.content })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label="Hapus memori"
                          onClick={() => void remove(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>

          <aside className="flex flex-col gap-3">
            <section className="flex flex-col gap-2 rounded-2xl border p-4 text-xs text-muted-foreground">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldCheck className="size-4" /> Cara kerja & privasi
              </h2>
              <p>
                Setelah Akai menjawab, pesan Anda diperiksa model untuk fakta yang layak diingat (tugas "Memori" di
                Model & pengaturan; kosong = tugas Umum).
              </p>
              <p>Kata sandi, PIN, token, nomor identitas/rekening, dan data kesehatan tidak dicatat.</p>
              <p>
                Bilang "lupakan …" di percakapan, atau hapus di sini. Memori hanya untuk akun Anda dan tidak dipakai
                aplikasi lain.
              </p>
              <p>Memori mati = Akai tidak mencatat dan tidak memakai memori yang ada.</p>
            </section>
            {state.items.length > 0 && (
              <Button variant="outline" className="text-destructive" onClick={() => setConfirmClear(true)}>
                <Trash2 data-icon="inline-start" /> Hapus semua memori ({state.items.length})
              </Button>
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Hapus semua memori?"
        description="Semua yang diingat Akai tentang Anda dihapus permanen. Percakapan tidak terhapus."
        confirmLabel="Hapus semua"
        onConfirm={async () => {
          try {
            await memoryApi.clear();
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
