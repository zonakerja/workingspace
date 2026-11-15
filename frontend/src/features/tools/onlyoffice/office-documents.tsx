import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileStack, FolderOpen, Link2, PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PaginationControl } from "@/components/common/pagination-control";
import { RenameDialog } from "@/components/common/rename-dialog";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { queryKeys } from "@/data/query-keys";
import { useOfficeStatus, useOfficeTemplates, useOfficeWorkspace, useRenameOfficeWorkspace } from "@/data/use-office";
import { usePagination } from "@/hooks/use-pagination";
import { errorMessage } from "@/lib/api/client";
import { uploadsApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import type { OfficeWorkspaceDocument } from "@/types/api";
import { WorkspaceConceptNote } from "../workspace-concept-note";
import { filterDocuments, formatSize } from "../converter/converter-utils";
import { NewOfficeDocumentPicker, OFFICE_WORKSPACE_CONTEXT } from "./new-office-document-button";
import { OfficeTemplatesDialog } from "./onlyoffice-cards";
import { OFFICE_KIND_ICON, openOfficeEditor } from "./office-editor-host";
import { OFFICE_KIND_LABELS, officeKindOf } from "./office-formats";

/**
 * Tools → ONLYOFFICE → Dokumen: ruang kerja dokumen pribadi. Dokumen dibuat (kosong / templat / impor) dan tersimpan di sini
 * dengan context `office-workspace` — tidak menjadi Resource Global / File Control. Working Space memanggilnya lewat
 * "Buat Dokumen (ONLYOFFICE) → Dari Dokumen Saya" (salinan).
 */
export function OfficeDocuments() {
  const { data: status } = useOfficeStatus();
  const enabled = status?.enabled ?? false;
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceConceptNote kind="office" />
      {enabled ? (
        <CreateCard />
      ) : (
        <p className="rounded-xl border p-3 text-sm text-muted-foreground">
          Server ONLYOFFICE belum aktif — dokumen baru belum bisa dibuat. Dokumen yang sudah ada tetap tercantum di
          bawah.
        </p>
      )}
      <DocumentList enabled={enabled} />
    </div>
  );
}

function CreateCard() {
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { data: templates = [] } = useOfficeTemplates();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.officeWorkspace });
  return (
    <SectionCard
      icon={FilePlus2}
      title="Buat dokumen"
      description="Dokumen kosong, dari templat, atau impor berkas — langsung terbuka di editor dan tersimpan di daftar di bawah."
      action={
        <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
          <FileStack /> Templat dokumen <span className="text-muted-foreground">({templates.length})</span>
        </Button>
      }
      contentClassName="flex flex-col gap-3"
    >
      <OfficeTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <Field className="max-w-md">
        <FieldLabel htmlFor="office-ws-title">Judul (opsional)</FieldLabel>
        <Input
          id="office-ws-title"
          value={title}
          maxLength={120}
          placeholder="mis. Konsep Nota Dinas Rapat Koordinasi"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <NewOfficeDocumentPicker
        title={title}
        context={OFFICE_WORKSPACE_CONTEXT}
        onCreated={(asset) => {
          setTitle("");
          refresh();
          openOfficeEditor({ uploadId: asset.id, name: asset.originalName, onClosed: refresh });
        }}
      />
    </SectionCard>
  );
}

function DocumentList({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const { data: docs = [], isLoading } = useOfficeWorkspace();
  const rename = useRenameOfficeWorkspace();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<OfficeWorkspaceDocument | null>(null);
  const [deleting, setDeleting] = useState<OfficeWorkspaceDocument | null>(null);
  const filtered = filterDocuments(
    docs.map((doc) => ({ ...doc, title: doc.name, fileName: doc.originalName })),
    query,
  );
  const { pageItems, setPage, controlProps } = usePagination(filtered, 10);
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.officeWorkspace });

  const open = (doc: OfficeWorkspaceDocument) =>
    openOfficeEditor({ uploadId: doc.id, name: doc.originalName, onClosed: refresh });

  const confirmDelete = async () => {
    if (!deleting) return;
    const doc = deleting;
    setDeleting(null);
    try {
      await uploadsApi.remove(doc.id);
      refresh();
    } catch (error) {
      toast.error("Gagal menghapus dokumen", { description: errorMessage(error) });
    }
  };

  return (
    <SectionCard
      icon={FolderOpen}
      title="Dokumen saya"
      description="Dokumen yang dibuat di ruang kerja ini. Klik untuk membuka di editor; perubahan tersimpan otomatis."
      action={
        docs.length > 0 && (
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Cari dokumen…"
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
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>Belum ada dokumen</EmptyTitle>
            <EmptyDescription>Buat dokumen di atas; hasilnya tersimpan di sini.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !filtered.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Tidak ada dokumen yang cocok.</p>
      ) : (
        <>
          <div className="divide-y rounded-xl border">
            {pageItems.map((doc) => {
              const kind = officeKindOf(doc.originalName, doc.mimeType);
              const Icon = OFFICE_KIND_ICON[kind ?? "word"];
              return (
                <div key={doc.id} className="group flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(doc)}
                    disabled={!enabled}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{doc.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {kind ? OFFICE_KIND_LABELS[kind] : doc.format.toUpperCase()} · {formatSize(doc.size)} · disimpan{" "}
                        {formatDateTime(doc.savedAt)}
                      </span>
                    </span>
                  </button>
                  <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    <Badge variant="outline">{doc.format.toUpperCase()}</Badge>
                    {doc.version > 1 && <Badge variant="outline">Versi {doc.version}</Badge>}
                    {doc.finals > 0 && (
                      <Badge variant="outline" title="Dokumen final yang tertaut ke konsep ini">
                        <Link2 /> Final {doc.finals}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setRenaming(doc)}
                      aria-label="Ganti judul"
                      title="Ganti judul"
                    >
                      <PencilLine />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setDeleting(doc)}
                      aria-label="Hapus"
                      title="Hapus"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <PaginationControl {...controlProps} />
        </>
      )}
      <RenameDialog
        open={!!renaming}
        onOpenChange={(value) => !value && setRenaming(null)}
        title="Ganti judul dokumen"
        label="Judul"
        initialValue={renaming?.name ?? ""}
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
        onOpenChange={(value) => !value && setDeleting(null)}
        title="Hapus dokumen?"
        description="Dokumen dipindah ke Sampah dan bisa dipulihkan selama 30 hari. Salinan yang sudah dipakai di Working Space tidak ikut terhapus."
        itemName={deleting?.name}
        confirmLabel="Hapus"
        onConfirm={() => void confirmDelete()}
      />
    </SectionCard>
  );
}
