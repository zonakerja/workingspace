import { FileCode2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SearchInput } from "@/components/common/search-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useConvertedDocuments } from "@/data/use-converter";
import { errorMessage } from "@/lib/api/client";
import { converterApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { filterDocuments, formatCount, markdownFileName } from "./converter-utils";

/**
 * Tombol "Dari MD Converter" di form Resource & lampiran Working Space: hasil di pustaka Tools → Markdown Converter →
 * Dokumen disalin menjadi berkas `.md` baru (versi dirapikan AI bila ada). Pemanggil mengunggahnya seperti berkas yang
 * dipilih dari komputer, sehingga aturan form (Ringkas AI, File Control, tag, buang saat batal) tetap berlaku dan pustaka
 * tidak tersentuh.
 */
export function ConvertedDocumentPicker({ disabled, onPick }: { disabled?: boolean; onPick: (file: File) => void }) {
  const { data: docs = [] } = useConvertedDocuments();
  const done = docs.filter((doc) => doc.status === "done");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!done.length) return null;
  const shown = filterDocuments(done, query).slice(0, 100);

  const pick = async (id: string) => {
    setBusyId(id);
    try {
      const doc = await converterApi.document(id);
      const markdown = doc.enhancedMarkdown || doc.markdown || "";
      if (!markdown.trim()) {
        toast.error("Hasil konversi ini kosong.");
        return;
      }
      onPick(new File([markdown], markdownFileName(`${doc.title}.md`), { type: "text/markdown" }));
      setOpen(false);
    } catch (error) {
      toast.error("Gagal mengambil hasil konversi", { description: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        title="Salin hasil dari Tools → Markdown Converter → Dokumen sebagai berkas .md"
        onClick={() => setOpen(true)}
      >
        <FileCode2 /> Dari MD Converter <span className="text-muted-foreground">({done.length})</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90svh] grid-cols-1 flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="size-4 text-module" /> Dari MD Converter
            </DialogTitle>
            <DialogDescription>
              Hasil konversi disalin ke sini sebagai berkas .md baru (versi dirapikan AI bila ada). Hasil asal tetap di
              pustaka Markdown Converter dan tidak menjadi Resource.
            </DialogDescription>
          </DialogHeader>
          <SearchInput value={query} onChange={setQuery} placeholder="Cari judul / berkas…" className="md:w-full" />
          <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-xl border">
            {!shown.length ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Tidak ada hasil yang cocok.</p>
            ) : (
              shown.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => void pick(doc.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-60"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
                    {busyId === doc.id ? <Spinner className="size-4" /> : <FileCode2 className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{doc.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {doc.fileName} · {formatDateTime(doc.createdAt)}
                      {doc.summary.tokens !== null ? ` · ± ${formatCount(doc.summary.tokens)} token` : ""}
                      {doc.summary.enhanced ? " · dirapikan AI" : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
