import { Archive, ArchiveRestore, Pencil, Plus, Star, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TagInput } from "@/components/common/tag-input";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRequestCategories, useRequestCategoryMutations } from "@/data/use-requests";
import { useOpenSession } from "@/hooks/use-retained";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { RequestCategory } from "@/types/api";

/** Tombol pembuka pengelolaan kategori Approval (di samping saringan kategori). */
export function RequestCategoriesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="shrink-0">
        <Tags /> Kategori
      </Button>
      <RequestCategoriesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Kategori pengajuan milik pemilik: tambah, ubah nama/keterangan/kata kunci, jadikan bawaan, arsipkan, hapus (bila belum
 * dipakai). Kata kunci menentukan kategori otomatis untuk pengajuan baru (WhatsApp, AI agent, formulir "Otomatis").
 */
function RequestCategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { categories, isLoading } = useRequestCategories();
  const m = useRequestCategoryMutations();
  const [editing, setEditing] = useState<RequestCategory | "new" | null>(null);
  const session = useOpenSession(!!editing);
  const run = (promise: Promise<unknown>, success: string) =>
    promise.then(() => toast.success(success)).catch((e) => toast.error(errorMessage(e)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kategori pengajuan</DialogTitle>
          <DialogDescription>
            Kategori Approval milik Anda — sesuaikan bila tugas berganti. Kata kunci dipakai untuk menentukan kategori
            pengajuan baru secara otomatis; kategori yang tidak cocok kata kunci mana pun masuk kategori bawaan (★).
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <CategoryForm
            key={session}
            category={editing === "new" ? null : editing}
            saving={m.create.isPending || m.update.isPending}
            onCancel={() => setEditing(null)}
            onSave={(input) => {
              const promise =
                editing === "new" ? m.create.mutateAsync(input) : m.update.mutateAsync({ id: editing.id, input });
              void run(promise, "Kategori disimpan.").then(() => setEditing(null));
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {isLoading && <p className="text-sm text-muted-foreground">Memuat…</p>}
            {categories.map((c) => (
              <div
                key={c.id}
                className={cn("grid min-w-0 grid-cols-1 gap-1.5 rounded-xl border p-3", c.archived && "opacity-60")}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium" title={c.label}>
                    {c.isDefault && <Star className="mr-1 inline size-3.5 fill-current text-warning" />}
                    {c.label}
                  </span>
                  <Badge variant="outline">{c.requestCount} pengajuan</Badge>
                  {c.archived && <Badge variant="secondary">Diarsipkan</Badge>}
                  <Button size="icon-sm" variant="ghost" title="Ubah" onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  {!c.isDefault && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Jadikan kategori bawaan"
                      onClick={() =>
                        void run(
                          m.update.mutateAsync({ id: c.id, input: { isDefault: true } }),
                          "Kategori bawaan diganti.",
                        )
                      }
                    >
                      <Star />
                    </Button>
                  )}
                  {!c.isDefault && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title={c.archived ? "Pulihkan dari arsip" : "Arsipkan (tidak bisa dipilih untuk pengajuan baru)"}
                      onClick={() =>
                        void run(
                          m.update.mutateAsync({ id: c.id, input: { archived: !c.archived } }),
                          c.archived ? "Kategori dipulihkan." : "Kategori diarsipkan.",
                        )
                      }
                    >
                      {c.archived ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  )}
                  {!c.isDefault && c.requestCount === 0 && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Hapus kategori"
                      onClick={() => void run(m.remove.mutateAsync(c.id), "Kategori dihapus.")}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                <p className="text-[11px] text-muted-foreground">
                  Kata kunci: {c.keywords.length ? c.keywords.join(", ") : "— (hanya dipilih manual)"}
                </p>
              </div>
            ))}
          </div>
        )}
        {!editing && (
          <DialogFooter>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Kategori baru
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  saving,
  onCancel,
  onSave,
}: {
  category: RequestCategory | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: { label: string; description: string | null; keywords: string[] }) => void;
}) {
  const [label, setLabel] = useState(category?.label ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [keywords, setKeywords] = useState<string[]>(category?.keywords ?? []);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cat-label">Nama kategori *</Label>
        <Input id="cat-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cat-desc">Keterangan</Label>
        <Textarea
          id="cat-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="Untuk apa kategori ini (juga dibaca AI agent saat menetapkan kategori)"
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Kata kunci penentuan otomatis</Label>
        <TagInput
          value={keywords}
          onAdd={(tag) =>
            setKeywords((prev) => (prev.some((k) => k.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]))
          }
          onRemove={(tag) => setKeywords((prev) => prev.filter((k) => k !== tag))}
          placeholder="mis. sewa, pinjam pakai, disposisi"
        />
        <p className="text-[11px] text-muted-foreground">
          Dicocokkan sebagai kata/frasa utuh di judul, perihal, pemohon, isi, dan nama berkas. Kata kunci terpanjang
          yang cocok menang. Kosongkan bila kategori hanya dipilih manual.
        </p>
      </div>
      {category && <p className="text-[11px] text-muted-foreground">Kunci tetap: {category.key}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button
          disabled={!label.trim() || saving}
          onClick={() => onSave({ label: label.trim(), description: description.trim() || null, keywords })}
        >
          Simpan
        </Button>
      </DialogFooter>
    </div>
  );
}
