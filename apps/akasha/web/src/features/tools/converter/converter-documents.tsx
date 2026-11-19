import { FileText, FileUp, Library, PencilLine, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PaginationControl } from "@/components/common/pagination-control";
import { RenameDialog } from "@/components/common/rename-dialog";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useConvertedDocument,
  useConvertedDocuments,
  useCreateConvertedDocument,
  useRemoveConvertedDocument,
  useRenameConvertedDocument,
} from "@/data/use-converter";
import { usePagination } from "@/hooks/use-pagination";
import { useSearchParam } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ConvertedDocumentSummary, ConverterMode, ConverterPrefs, ConverterStatus } from "@/types/api";
import { ConversionResultView } from "./conversion-result";
import { WorkspaceConceptNote } from "../workspace-concept-note";
import {
  CONVERTER_ACCEPT,
  DOCUMENT_STATUS_LABELS,
  documentResult,
  filterDocuments,
  formatCount,
  formatSize,
  isDocumentPending,
  MODE_OPTIONS,
} from "./converter-utils";

/** Berkas sekali pilih paling banyak sebanyak ini (antrean server maks. 10 per user). */
const MAX_FILES_PER_PICK = 10;

/**
 * Pustaka Markdown Converter: berkas dikonversi di latar belakang dan hasilnya disimpan, sehingga bisa dibuka lagi kapan saja
 * tanpa harus menunggu di halaman. Berkas asal tidak disimpan; hapus = permanen.
 */
export function ConverterDocuments({ status, prefs }: { status?: ConverterStatus; prefs?: ConverterPrefs }) {
  const [openId, setOpenId] = useSearchParam("doc");
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceConceptNote kind="converter" />
      <UploadCard key={prefs ? "ready" : "loading"} status={status} prefs={prefs} />
      <DocumentList onOpen={(id) => setOpenId(id, { replace: false })} />
      <DocumentDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function UploadCard({ status, prefs }: { status?: ConverterStatus; prefs?: ConverterPrefs }) {
  const create = useCreateConvertedDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ConverterMode>("auto");
  const [enhance, setEnhance] = useState(() => prefs?.aiEnhance ?? false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const disabled = !status?.reachable;

  const upload = async (files: File[]) => {
    const picked = files.slice(0, MAX_FILES_PER_PICK);
    if (files.length > picked.length) toast.warning(`Hanya ${MAX_FILES_PER_PICK} berkas pertama yang diunggah.`);
    for (const file of picked) {
      if (status && file.size > status.maxMb * 1024 * 1024) {
        toast.error(`${file.name}: berkas maksimal ${status.maxMb} MB.`);
        continue;
      }
      setUploading((count) => count + 1);
      try {
        const doc = await create.mutateAsync({ file, mode, enhance });
        if (doc.reused)
          toast.info(`${file.name} sudah ada di pustaka`, {
            description: `Berkas sama dengan pilihan sama: "${doc.title}" dipakai ulang tanpa dikonversi lagi.`,
          });
      } catch (error) {
        toast.error(`${file.name} gagal diunggah`, { description: errorMessage(error) });
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) void upload(files);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length && !disabled) void upload(files);
  };

  return (
    <SectionCard
      icon={FileUp}
      title="Konversi & simpan"
      description="Berkas diubah ke Markdown di latar belakang dan hasilnya disimpan di pustaka di bawah — boleh ditinggal ke halaman lain. Berkas asal tidak disimpan."
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select value={mode} onValueChange={(value) => setMode(value as ConverterMode)}>
          <SelectTrigger className="w-40" aria-label="Mesin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={enhance} onCheckedChange={(checked) => setEnhance(checked === true)} />
          Rapikan dengan AI
        </label>
        <Button onClick={() => inputRef.current?.click()} disabled={disabled}>
          {uploading ? <Spinner /> : <FileUp />}
          {uploading ? "Mengunggah…" : "Pilih berkas"}
        </Button>
        <input ref={inputRef} type="file" multiple accept={CONVERTER_ACCEPT} className="hidden" onChange={onPick} />
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground",
          dragging && "border-module bg-module-soft",
        )}
      >
        {disabled
          ? "Service Markdown Converter tidak menyala — hasil yang sudah tersimpan tetap bisa dibuka."
          : `Atau seret berkas ke sini (maks. ${MAX_FILES_PER_PICK} sekaligus) — PDF, DOCX, XLSX/XLS, PPTX, EPUB, HTML, CSV, gambar.`}
      </div>
    </SectionCard>
  );
}

function DocumentList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: docs = [], isLoading } = useConvertedDocuments();
  const rename = useRenameConvertedDocument();
  const remove = useRemoveConvertedDocument();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ConvertedDocumentSummary | null>(null);
  const [deleting, setDeleting] = useState<ConvertedDocumentSummary | null>(null);
  const filtered = filterDocuments(docs, query);
  const { pageItems, setPage, controlProps } = usePagination(filtered, 10);

  const confirmDelete = () => {
    if (!deleting) return;
    const doc = deleting;
    setDeleting(null);
    remove.mutate(doc.id, {
      onSuccess: () => toast.success("Dokumen dihapus permanen."),
      onError: (error) => toast.error("Gagal menghapus", { description: errorMessage(error) }),
    });
  };

  return (
    <SectionCard
      icon={Library}
      title="Dokumen tersimpan"
      description="Hasil konversi yang bisa dibuka lagi, disalin, diunduh, atau disimpan ke Inbox vault. Tidak dibaca fitur AI lain."
      action={
        docs.length > 0 && (
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Cari judul / berkas…"
          />
        )
      }
      contentClassName="flex flex-col gap-2"
    >
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : !docs.length ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>Belum ada dokumen</EmptyTitle>
            <EmptyDescription>Unggah berkas di atas; hasilnya tersimpan di sini.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !filtered.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Tidak ada dokumen yang cocok.</p>
      ) : (
        <>
          <div className="divide-y rounded-xl border">
            {pageItems.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onOpen={() => onOpen(doc.id)}
                onRename={() => setRenaming(doc)}
                onDelete={() => setDeleting(doc)}
              />
            ))}
          </div>
          <PaginationControl {...controlProps} />
        </>
      )}
      <RenameDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Ganti judul"
        label="Judul"
        initialValue={renaming?.title ?? ""}
        onSave={(title) => {
          if (!renaming || !title.trim()) return;
          rename.mutate(
            { id: renaming.id, title },
            { onError: (error) => toast.error("Gagal mengganti judul", { description: errorMessage(error) }) },
          );
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus dokumen hasil konversi?"
        description="Hasil Markdown dihapus permanen (tidak masuk Sampah). Berkas asal tidak pernah disimpan di pustaka ini."
        itemName={deleting?.title}
        confirmLabel="Hapus permanen"
        onConfirm={confirmDelete}
      />
    </SectionCard>
  );
}

function StatusBadge({ doc }: { doc: ConvertedDocumentSummary }) {
  const tone =
    doc.status === "done" ? "text-success" : doc.status === "failed" ? "text-destructive" : "text-muted-foreground";
  return (
    <Badge variant="outline" className={tone}>
      {isDocumentPending(doc.status) && <Spinner className="size-3" />}
      {DOCUMENT_STATUS_LABELS[doc.status]}
    </Badge>
  );
}

function DocumentRow({
  doc,
  onOpen,
  onRename,
  onDelete,
}: {
  doc: ConvertedDocumentSummary;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 px-3 py-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
          <FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{doc.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {doc.fileName} · {formatSize(doc.size)} · {formatDateTime(doc.createdAt)}
            {doc.status === "failed" && doc.error ? ` · ${doc.error}` : ""}
          </span>
        </span>
      </button>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {doc.engine && <Badge variant="secondary">{doc.engine === "docling" ? "Docling" : "MarkItDown"}</Badge>}
        {doc.summary.tokens !== null && <Badge variant="outline">± {formatCount(doc.summary.tokens)} token</Badge>}
        {doc.summary.enhanced && (
          <Badge variant="outline">
            <Sparkles /> Dirapikan
          </Badge>
        )}
      </div>
      <StatusBadge doc={doc} />
      <div className="flex shrink-0 items-center gap-0.5 pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
        <Button size="icon-sm" variant="ghost" onClick={onRename} aria-label="Ganti judul" title="Ganti judul">
          <PencilLine />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Hapus" title="Hapus permanen">
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function DocumentDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: doc, isLoading, error } = useConvertedDocument(id);
  const result = doc ? documentResult(doc) : null;
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-cols-1 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{doc?.title ?? "Dokumen hasil konversi"}</DialogTitle>
          {doc && (
            <p className="truncate text-xs text-muted-foreground">
              {doc.fileName} · {formatSize(doc.size)} · {formatDateTime(doc.createdAt)}
            </p>
          )}
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : error || !doc ? (
          <p className="text-sm text-muted-foreground">Dokumen tidak ditemukan (mungkin sudah dihapus).</p>
        ) : isDocumentPending(doc.status) ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> {doc.status === "queued" ? "Menunggu giliran…" : "Sedang dikonversi…"} Boleh ditutup; hasilnya
            tersimpan otomatis.
          </p>
        ) : doc.status === "failed" ? (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            {doc.error ?? "Konversi gagal."}
          </p>
        ) : result ? (
          <ConversionResultView key={doc.id} result={result} title={doc.title} scrollClassName="max-h-[55svh]" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
