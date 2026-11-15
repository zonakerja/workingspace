import { formatLocalYMD } from "@/lib/dates";
import {
  Archive,
  BookOpen,
  FilePen,
  FileText,
  Globe,
  Layers,
  LayoutGrid,
  List,
  type LucideIcon,
  NotebookPen,
  Plus,
  Trash2,
  Upload,
  Tags,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateRangeFilter } from "@/components/common/date-range-filter";
import { type PageSize, PaginationControl, paginate } from "@/components/common/pagination-control";
import { type OptionGroup, SearchableSelect } from "@/components/common/searchable-select";
import { TagInput } from "@/components/common/tag-input";
import { SearchInput } from "@/components/common/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { useAiNotes, useFreeNotes, useLists, useResources } from "@/data/collections";
import {
  NewOfficeDocumentPicker,
  OFFICE_ATTACHMENT_LABEL,
  OFFICE_ATTACHMENT_TYPE,
  useOfficeEnabled,
} from "@/features/tools/onlyoffice/new-office-document-button";
import { ConvertedDocumentPicker } from "@/features/tools/converter/converted-document-picker";
import { openOfficeEditor } from "@/features/tools/onlyoffice/office-editor-host";
import { isOfficeEditable } from "@/features/tools/onlyoffice/office-formats";
import { useOfficeDiscardConfirm } from "@/features/tools/onlyoffice/use-office-discard-confirm";
import type { UploadedAsset } from "@/types/api";
import { ResourceAiDialog } from "@/features/resources/resource-ai-dialog";
import { useAttachmentCleanup } from "@/features/resources/use-attachment-cleanup";
import { noteAttachmentPath, openAttachment } from "@/features/resources/resource-utils";
import { readAiSummaryPreference, writeAiSummaryPreference } from "@/features/resources/ai-summary-preference";
import {
  addFreeTag,
  collectFreeTags,
  hasTag,
  nextRemovedTags,
  MAX_TAG_LENGTH,
  resourceTags,
  splitTags,
} from "@/features/resources/resource-tags";
import {
  archiveLockReason,
  fileControlStatus,
  isFiledArchive,
  isInFileControl,
  readFileControlPreference,
  writeFileControlPreference,
} from "@/features/resources/file-control-intake";
import { SummaryStatusBadge } from "@/features/resources/summary-status-badge";
import { useFileSummarizer } from "@/features/resources/use-file-summarizer";
import { usePermissions } from "@/hooks/use-permissions";
import { useSearchParam } from "@/hooks/use-search-param";
import { useToday } from "@/hooks/use-today";
import { errorMessage } from "@/lib/api/client";
import { uploadsApi } from "@/lib/api/endpoints";
import { DEFAULT_DATE_FILTER, matchesDateFilter } from "@/lib/date-filter";
import { trackPendingUpload, untrackPendingUpload } from "@/lib/pending-uploads";
import { generateId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import type { Resource } from "@/types/entities";
import { AccessScope } from "@/components/common/access-scope";
import { links } from "@/lib/deep-links";
import { PARA_INFO, replacedUploadId, resourceFileAttachment } from "../lib/para";
import { DiscardScope, useDiscardOnClose, useDiscardScope } from "../use-attachment-edits";
import { useParaActions } from "../use-para-actions";
import { ParaInfo } from "./para-info";
import { ResourceGrid, ResourceTable } from "./resource-views";
import { ensureUnlocked, isSealed, withUnlocked } from "@/features/security/lock-controls";
import { countResourceTypes, resourceTypeGroup, type ResourceTypeFilter } from "../lib/resource-view";
import { ResourceTagsDialog } from "./resource-tags-dialog";
import { useOpenSession, useRetained } from "@/hooks/use-retained";
import { useOfficeLinkBadges } from "@/data/use-office";
import { useNotebookUsage } from "@/data/use-notebooks";

/** Waktu sekarang (helper modul agar tidak dianggap pemanggilan tidak murni saat render) */
const nowIso = () => new Date().toISOString();
/** Tanggal lokal hari ini (YMD) — bukan potongan ISO yang bertanggal UTC */
const todayYmd = () => formatLocalYMD(new Date());
const ALL_TAGS = "__all__";

type ResourceViewMode = "grid" | "table";
const VIEW_KEY = "akasha.resources.view";
const readViewPreference = (): ResourceViewMode => {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
};
const writeViewPreference = (view: ResourceViewMode) => {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // penyimpanan browser tidak tersedia: pilihan hanya berlaku di sesi ini
  }
};

/** Kartu ringkasan yang sekaligus menjadi filter jenis. */
const TYPE_CHIPS: { value: ResourceTypeFilter; label: string; icon: LucideIcon; tone: string }[] = [
  { value: "all", label: "Semua resource", icon: Layers, tone: "bg-module-gradient text-white" },
  { value: "file", label: "Berkas", icon: FileText, tone: "bg-info/12 text-info" },
  { value: "link", label: "Web link", icon: Globe, tone: "bg-mod-planner/15 text-mod-planner" },
  { value: "note", label: "Catatan / List", icon: NotebookPen, tone: "bg-mod-knowledge/15 text-mod-knowledge" },
];

export function ResourcesTab() {
  const today = useToday();
  const { items: resources, setItems: setResources } = useResources();
  const { canEdit } = usePermissions();
  const actions = useParaActions();
  const navigate = useNavigate();
  // Resource catatan (tanpa berkas/link) dibuka di Notes Space; berkas di modal pratinjau, link di tab baru
  const openResource = (res: Resource) => {
    const notePath = !res.uploadId && !res.url ? noteAttachmentPath(res.noteId) : null;
    if (notePath) void navigate(notePath);
    else void openAttachment(res);
  };
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(DEFAULT_DATE_FILTER);
  // Filter per tag bebas (kategori isi) + dialog Kelola Tag
  const [tagFilter, setTagFilter] = useState(ALL_TAGS);
  const [managingTags, setManagingTags] = useState(false);
  // Filter jenis (kartu ringkasan) + tampilan grid/tabel (diingat per browser)
  const [typeFilter, setTypeFilter] = useState<ResourceTypeFilter>("all");
  const [view, setView] = useState<ResourceViewMode>(readViewPreference);
  const changeView = (next: ResourceViewMode) => {
    setView(next);
    writeViewPreference(next);
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [aiTarget, setAiTarget] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const cleanup = useAttachmentCleanup();
  // Berkas milik resource yang dihapus: ikut dihapus dari storage bila tidak dipakai di tempat lain
  const deletingFile = deleting ? resourceFileAttachment(deleting) : null;
  const deletingFileShared =
    !!deletingFile?.uploadId && cleanup.referenced([], [deleting!.id]).has(deletingFile.uploadId);
  const deletingInFileControl = !!deleting && isInFileControl(deleting);
  // Resource yang menjadi sumber My Notebook: diberi tahu (sumber di notebook tidak lagi bisa dibaca)
  const { data: notebookUsage } = useNotebookUsage();
  const deletingNotebooks = deleting
    ? [
        ...new Set(
          (notebookUsage ?? [])
            .filter((u) => u.recordType === "para_resource" && u.recordId === deleting.id)
            .map((u) => u.notebookTitle),
        ),
      ]
    : [];
  // Arsip yang sudah diberkaskan hanya boleh disusutkan lewat File Control (berita acara), bukan dihapus di sini
  const requestDelete = (res: Resource) => {
    const reason = archiveLockReason(res);
    if (!reason) return setDeleting(res);
    toast.error("Arsip tidak bisa dihapus dari Resources", {
      description: reason,
      action: {
        label: "Buka di File Control",
        onClick: () => void navigate(links.archive(res.id, res.archivalStatus === "physical" ? "physical" : "digital")),
      },
    });
  };
  const [archiving, setArchiving] = useState<Resource | null>(null);
  // Deep link ?resource=<id> menyorot baris resource
  const [highlightId] = useSearchParam("resource");

  const filtered = resources
    // Cari di nama resource atau tag (mis. "SOP", "Regulasi")
    .filter((r) => {
      const q = search.trim().toLowerCase();
      return !q || [r.title ?? "", ...resourceTags(r)].some((v) => v.toLowerCase().includes(q));
    })
    .filter((r) => matchesDateFilter(r.date, dateFilter, today))
    .filter((r) => tagFilter === ALL_TAGS || hasTag(r, tagFilter))
    .filter((r) => typeFilter === "all" || resourceTypeGroup(r) === typeFilter)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const pageItems = paginate(filtered, page, pageSize);
  const tagOptions = collectFreeTags(resources);
  // Penanda konsep ↔ dokumen final untuk berkas di halaman ini
  const linkBadges = useOfficeLinkBadges(pageItems.map((res) => res.uploadId));

  const typeCounts = countResourceTypes(resources);
  const fileControlCount = resources.filter(isInFileControl).length;
  const hasFilter = !!search.trim() || tagFilter !== ALL_TAGS || typeFilter !== "all" || dateFilter.mode !== "all";
  const resetFilters = () => {
    setSearch("");
    setTagFilter(ALL_TAGS);
    setTypeFilter("all");
    setDateFilter(DEFAULT_DATE_FILTER);
    setPage(1);
  };
  const viewProps = {
    items: pageItems,
    highlightId,
    linkBadges,
    canEdit,
    // Item terkunci PIN: minta PIN dulu (data dimuat ulang utuh), lalu klik lagi untuk membuka
    onOpen: (res: Resource) => (isSealed(res) ? void ensureUnlocked(res) : openResource(res)),
    onAi: (res: Resource) => (isSealed(res) ? void ensureUnlocked(res) : setAiTarget(res)),
    onEdit: (res: Resource) => (isSealed(res) ? void ensureUnlocked(res) : setEditing(res)),
    onSaveLock: (next: Resource) => setResources((prev) => prev.map((r) => (r.id === next.id ? next : r))),
    onArchive: (res: Resource) => withUnlocked(res, () => setArchiving(res)),
    onDelete: (res: Resource) => withUnlocked(res, () => requestDelete(res)),
  };

  return (
    <div className="flex flex-col gap-4">
      <ParaInfo icon={BookOpen} {...PARA_INFO.resources} />

      {/* Ringkasan per jenis sekaligus filter cepat */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {TYPE_CHIPS.map((chip) => {
          const Icon = chip.icon;
          const active = typeFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => {
                setTypeFilter(chip.value);
                setPage(1);
              }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm",
                active && "border-module ring-1 ring-module",
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", chip.tone)}>
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xl leading-none font-bold tabular-nums">{typeCounts[chip.value]}</span>
                <span className="block truncate text-xs text-muted-foreground">{chip.label}</span>
              </span>
            </button>
          );
        })}
        <div className="flex items-center gap-3 rounded-2xl border border-dashed bg-card p-3 max-lg:hidden">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-mod-files/15 text-mod-files">
            <Archive className="size-4.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-xl leading-none font-bold tabular-nums">{fileControlCount}</span>
            <span className="block truncate text-xs text-muted-foreground">Di File Control</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Cari nama atau tag..."
          />
          <DateRangeFilter
            value={dateFilter}
            onChange={(v) => {
              setDateFilter(v);
              setPage(1);
            }}
            labels={{ custom: "Custom" }}
          />
          {tagOptions.length > 0 && (
            <Select
              value={tagFilter}
              onValueChange={(v) => {
                setTagFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-40" title="Filter tag">
                <Tags /> <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TAGS}>Semua tag</SelectItem>
                {tagOptions.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={view}
            onValueChange={(v) => v && changeView(v as ResourceViewMode)}
            aria-label="Tampilan"
          >
            <ToggleGroupItem value="grid" title="Tampilan grid">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" title="Tampilan tabel">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
          {canEdit && (
            <Button variant="outline" onClick={() => setManagingTags(true)}>
              <Tags /> <span className="max-sm:hidden">Kelola Tag</span>
            </Button>
          )}
          {canEdit && (
            <Button className="ml-auto lg:ml-0" onClick={() => setEditing("new")}>
              <Plus /> Tambah
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>{hasFilter ? "Tidak ada resource yang cocok" : "Belum ada resource"}</EmptyTitle>
            <EmptyDescription>
              {hasFilter
                ? "Ubah kata kunci atau filter untuk melihat resource lain."
                : "Simpan dokumen, tautan, dan catatan rujukan di sini agar mudah ditemukan kembali."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {hasFilter ? (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Hapus filter
              </Button>
            ) : (
              canEdit && (
                <Button size="sm" onClick={() => setEditing("new")}>
                  <Plus /> Tambah Resource
                </Button>
              )
            )}
          </EmptyContent>
        </Empty>
      ) : view === "grid" ? (
        <ResourceGrid {...viewProps} />
      ) : (
        <ResourceTable {...viewProps} />
      )}

      <PaginationControl
        totalItems={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <ResourceTagsDialog open={managingTags} onOpenChange={setManagingTags} />
      <ResourceFormDialog resource={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ResourceAiDialog
        resource={aiTarget}
        onOpenChange={(open) => !open && setAiTarget(null)}
        onSave={(id, summary) =>
          setResources((prev) => prev.map((r) => (r.id === id ? { ...r, aiSummary: summary } : r)))
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus Resource?"
        description={
          !deletingFile
            ? "Anda yakin ingin menghapus item ini secara permanen dari database?"
            : (deletingFileShared
                ? "Resource ini dipindah ke Sampah dan bisa dipulihkan selama 30 hari. Berkasnya tetap di tempat karena masih dipakai di tempat lain (lampiran item lain / arsip)."
                : "Resource ini beserta berkasnya dipindah ke Sampah dan bisa dipulihkan selama 30 hari.") +
              (deletingInFileControl
                ? " Resource ini juga terdaftar di File Control (Gantung) dan ikut keluar dari sana."
                : "") +
              (deletingNotebooks.length
                ? ` Resource ini menjadi sumber My Notebook: ${deletingNotebooks.join(", ")} — sumber itu tidak lagi bisa dibaca.`
                : "")
        }
        itemName={deleting?.title}
        confirmLabel="Konfirmasi Hapus"
        onConfirm={() => {
          if (deleting) {
            setResources((prev) => prev.filter((r) => r.id !== deleting.id));
            if (deletingFile) {
              cleanup.release([deletingFile], [], {
                contextTag: "Global Resource",
                exclude: [],
                excludeResourceIds: [deleting.id],
              });
            }
          }
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => !open && setArchiving(null)}
        title="Arsipkan Resource?"
        description="Item ini akan dipindahkan ke Arsip. Anda bisa memulihkannya nanti."
        itemName={archiving?.title}
        confirmLabel="Arsipkan"
        destructive={false}
        onConfirm={() => {
          if (archiving) actions.archiveResource(archiving);
          setArchiving(null);
        }}
      />
    </div>
  );
}

function ResourceFormDialog({
  resource: resourceProp,
  onOpenChange,
}: {
  resource: Resource | "new" | null;
  onOpenChange: (open: boolean) => void;
}) {
  const resource = useRetained(resourceProp);
  const session = useOpenSession(resourceProp !== null);
  const { register, discardAll } = useDiscardScope();
  // Penjaga dari form: false = jangan tutup (user memilih kembali di konfirmasi buang dokumen ONLYOFFICE)
  const closeGuardRef = useRef<(() => Promise<boolean>) | null>(null);
  const close = async () => {
    if (closeGuardRef.current && !(await closeGuardRef.current())) return;
    discardAll(); // Batal / X / Esc: buang berkas yang diunggah tetapi tidak jadi disimpan
    onOpenChange(false);
  };
  return (
    <Dialog open={resourceProp !== null} onOpenChange={(open) => (open ? onOpenChange(true) : void close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource === "new" ? "Tambah Resource" : "Edit Resource"}</DialogTitle>
        </DialogHeader>
        {resource !== null && (
          <AccessScope item={resource === "new" ? null : resource}>
            <DiscardScope register={register}>
              <ResourceForm
                key={session}
                resource={resource === "new" ? null : resource}
                onCancel={() => void close()}
                onDone={() => onOpenChange(false)}
                closeGuardRef={closeGuardRef}
              />
            </DiscardScope>
          </AccessScope>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResourceForm({
  resource,
  onCancel,
  onDone,
  closeGuardRef,
}: {
  resource: Resource | null;
  onCancel: () => void;
  onDone: () => void;
  /** Diisi form: dipanggil dialog sebelum ditutup (Batal / X / Esc) */
  closeGuardRef?: RefObject<(() => Promise<boolean>) | null>;
}) {
  const { items: allResources, setItems: setResources } = useResources();
  const cleanup = useAttachmentCleanup();
  // Berkas yang diunggah di sesi form ini (dibuang bila tidak disimpan / diganti lagi sebelum disimpan)
  const sessionUploads = useRef(new Set<string>());
  const savedRef = useRef(false);
  useDiscardOnClose(() => {
    if (savedRef.current || sessionUploads.current.size === 0) return;
    const ids = [...sessionUploads.current];
    ids.forEach(untrackPendingUpload);
    cleanup.discardUploads(ids);
    sessionUploads.current.clear();
  });
  const { items: freeNotes } = useFreeNotes();
  const { items: aiNotes } = useAiNotes();
  const { items: lists } = useLists();
  const summarizer = useFileSummarizer();
  // "Ringkas dengan AI" opsional (default mati, diingat per browser); hasil lama diabaikan bila berkas diganti
  const [aiSummary, setAiSummary] = useState(readAiSummaryPreference);
  // Dipakai callback editor ONLYOFFICE (ditutup setelah state berubah)
  const aiSummaryRef = useRef(aiSummary);
  useEffect(() => {
    aiSummaryRef.current = aiSummary;
  }, [aiSummary]);
  // Tipe "Buat Dokumen (ONLYOFFICE)" = berkas (tipe `file`) yang dibuat dari templat, bukan diunggah
  const [fileSource, setFileSource] = useState<"upload" | "office">("upload");
  const officeEnabled = useOfficeEnabled();
  // "Masukkan ke File Control": resource baru mengikuti preferensi terakhir, resource lama mengikuti statusnya.
  // Arsip yang sudah diberkaskan (fisik/digital) dikelola File Control → centang terkunci.
  const [toFileControl, setToFileControl] = useState(() =>
    resource ? isInFileControl(resource) : readFileControlPreference(),
  );
  const filed = isFiledArchive(resource?.archivalStatus);
  const toggleFileControl = (enabled: boolean) => {
    setToFileControl(enabled);
    if (!resource) writeFileControlPreference(enabled);
  };
  const lastFileRef = useRef<File | null>(null);
  const summaryRunRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const { uploadOwnerId } = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Resource>(
    () => resource ?? { id: "", title: "", number: "", type: "link", content: "", date: "", url: "", noteId: "" },
  );
  const patch = (values: Partial<Resource>) => setForm((prev) => ({ ...prev, ...values }));
  // Tag konteks (asal resource) dikunci; user hanya mengelola tag bebas. Resource baru dari tab ini bertag "Global Resource".
  const initialTags = splitTags(resource ? resourceTags(resource) : []);
  const contextTags = initialTags.context.length ? initialTags.context : ["Global Resource"];
  const [freeTags, setFreeTags] = useState(initialTags.free);
  const tagSuggestions = collectFreeTags(allResources);

  const noteGroups: OptionGroup[] = [
    { heading: "Free Notes", options: freeNotes.map((n) => ({ label: n.title, value: `free-${n.id}` })) },
    { heading: "AI Notes", options: aiNotes.map((n) => ({ label: n.title, value: `ai-${n.id}` })) },
    { heading: "List Bebas", options: lists.map((l) => ({ label: l.title, value: `list-${l.id}` })) },
  ];

  const selectNote = (value: string) => {
    let title: string | undefined;
    let aiSummary = "";
    if (value.startsWith("free-")) title = freeNotes.find((n) => `free-${n.id}` === value)?.title;
    else if (value.startsWith("ai-")) {
      const note = aiNotes.find((n) => `ai-${n.id}` === value);
      title = note?.title;
      aiSummary = note?.aiSummary ?? "";
    } else if (value.startsWith("list-")) title = lists.find((l) => `list-${l.id}` === value)?.title;
    if (title) patch({ noteId: value, title: form.title || title, content: "Linked Note / List", aiSummary });
  };

  /** Berkas baru (upload atau dokumen ONLYOFFICE baru) di sesi form ini — dibuang bila diganti / form dibatalkan. */
  const acceptAsset = (asset: UploadedAsset, title: string) => {
    // Upload sebelumnya di sesi ini (belum pernah tersimpan) langsung dibuang saat diganti
    if (form.uploadId && sessionUploads.current.delete(form.uploadId)) {
      untrackPendingUpload(form.uploadId);
      cleanup.discardUploads([form.uploadId]);
    }
    sessionUploads.current.add(asset.id);
    trackPendingUpload(asset.id); // tetap dibersihkan bila tab di-reload/ditutup sebelum disimpan
    patch({ uploadId: asset.id, mimeType: asset.mimeType, url: undefined, title, aiSummary: undefined });
  };
  const officeSource = form.type === "file" && fileSource === "office";
  // Konfirmasi sebelum dokumen ONLYOFFICE yang dibuat di form ini dibuang (batal / tutup / ganti tipe / hapus)
  const officeDiscard = useOfficeDiscardConfirm();
  // Tipe "Buat Dokumen" hanya untuk resource baru → dokumennya pasti dibuat di sesi form ini
  const sessionOfficeDoc = officeSource && !!form.uploadId;
  useEffect(() => {
    if (!closeGuardRef) return;
    closeGuardRef.current = async () =>
      savedRef.current || !sessionOfficeDoc || !form.uploadId || officeDiscard.confirm(form.uploadId);
    return () => {
      closeGuardRef.current = null;
    };
  });

  /**
   * Buang berkas sesi ini dari form (dan storage); ringkasan AI yang sedang berjalan diabaikan. `toTrash` = tombol
   * "Hapus dokumen" (sengaja dihapus → Sampah); selain itu dibuang (dokumen ONLYOFFICE berisi dipindah ke ruang kerja).
   */
  const dropSessionUpload = (toTrash = false) => {
    if (!form.uploadId || !sessionUploads.current.delete(form.uploadId)) return;
    untrackPendingUpload(form.uploadId);
    if (toTrash) void uploadsApi.remove(form.uploadId).catch(() => undefined);
    else cleanup.discardUploads([form.uploadId]);
    summaryRunRef.current++;
    summarizer.setStatus("idle");
    lastFileRef.current = null;
    patch({ uploadId: undefined, mimeType: undefined, aiSummary: undefined });
  };

  /** Tombol "Hapus dokumen": selalu dikonfirmasi; setelahnya jenis dokumen lain bisa dipilih. */
  const deleteOfficeDoc = async () => {
    if (!form.uploadId || !(await officeDiscard.confirm(form.uploadId, { explicit: true }))) return;
    dropSessionUpload(true);
  };

  /** Buka berkas di ONLYOFFICE; setelah ditutup (tersimpan) ringkas ulang isinya bila "Ringkas dengan AI" dicentang. */
  const editInOffice = (uploadId: string, name: string) =>
    openOfficeEditor({
      uploadId,
      name,
      onClosed: () => {
        if (aiSummaryRef.current) void runSummaryUpload(uploadId);
      },
    });

  /** Ringkas berkas yang sudah di server (dokumen ONLYOFFICE) dari teks ekstraksi backend. */
  const runSummaryUpload = async (uploadId: string) => {
    const run = ++summaryRunRef.current;
    const summary = await summarizer.summarizeUpload(uploadId);
    if (summary && run === summaryRunRef.current) patch({ aiSummary: summary });
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    let uploadedId = "";
    try {
      const asset = await uploadsApi.upload(file, "resource", uploadOwnerId);
      acceptAsset(asset, form.title || asset.originalName);
      lastFileRef.current = file;
      uploadedId = asset.id;
    } catch (error) {
      toast.error("Upload file gagal", { description: errorMessage(error) });
      setUploading(false);
      return;
    }
    setUploading(false);
    if (aiSummary) void runSummary(file, uploadedId);
    else summaryRunRef.current++;
  };

  const runSummary = async (file: File, uploadId?: string) => {
    const run = ++summaryRunRef.current;
    const summary = await summarizer.summarize(file, uploadId);
    if (summary && run === summaryRunRef.current) patch({ aiSummary: summary });
  };

  const toggleAiSummary = (enabled: boolean) => {
    setAiSummary(enabled);
    writeAiSummaryPreference(enabled);
    if (!enabled) {
      summaryRunRef.current++;
      summarizer.setStatus("idle");
    } else if (!form.aiSummary && summarizer.status !== "processing") {
      if (lastFileRef.current) void runSummary(lastFileRef.current, form.uploadId);
      else if (officeSource && form.uploadId) void runSummaryUpload(form.uploadId);
    }
  };

  const save = () => {
    if (!form.title.trim()) {
      toast.error("Nama resource wajib diisi.");
      return;
    }
    if (officeSource && !form.uploadId) {
      toast.error("Pilih jenis dokumen yang dibuat terlebih dahulu.");
      return;
    }
    const data: Resource = {
      ...form,
      tags: [...contextTags, ...freeTags],
      // Tag yang dihapus di sini tidak ditambahkan ulang dari lampiran item lain
      removedTags: nextRemovedTags(resource?.removedTags, initialTags.free, freeTags).length
        ? nextRemovedTags(resource?.removedTags, initialTags.free, freeTags)
        : undefined,
      title: form.title.trim(),
      date: form.date || todayYmd(),
      // Resource bukan berkas tidak menyimpan rujukan berkas
      ...(form.type === "file" ? {} : { uploadId: undefined, mimeType: undefined }),
      archivalStatus: fileControlStatus(resource?.archivalStatus, form.type === "file" && toFileControl),
    };
    if (resource) {
      setResources((prev) => prev.map((r) => (r.id === resource.id ? { ...r, ...data, id: resource.id } : r)));
    } else {
      setResources((prev) => [...prev, { ...data, id: generateId("res"), createdAt: nowIso() }]);
    }
    savedRef.current = true;
    sessionUploads.current.forEach(untrackPendingUpload); // kini tersimpan di data
    if (summarizer.status === "processing") {
      summaryRunRef.current++;
      toast.info("Ringkasan AI dilewati", { description: "Buat nanti lewat tombol AI pada resource." });
    }
    // Berkas lama yang diganti / tidak dipakai lagi dihapus dari storage (kecuali masih dipakai di tempat lain)
    const oldUploadId = replacedUploadId(resource, data);
    if (resource && oldUploadId) {
      const old = resourceFileAttachment({ ...resource, uploadId: oldUploadId });
      if (old)
        cleanup.release([old], [], { contextTag: "Global Resource", exclude: [], excludeResourceIds: [resource.id] });
    }
    onDone();
  };

  return (
    <FieldGroup className="gap-4">
      {officeDiscard.dialog}
      <div className="grid gap-3 md:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="res-number">Nomor</FieldLabel>
          <Input
            id="res-number"
            autoFocus
            placeholder="No."
            value={form.number ?? ""}
            onChange={(e) => patch({ number: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel>Tipe</FieldLabel>
          <Select
            disabled={filed}
            value={officeSource ? OFFICE_ATTACHMENT_TYPE : form.type}
            onValueChange={async (v) => {
              const office = v === OFFICE_ATTACHMENT_TYPE;
              // Berkas sesi ini dari sumber lain (upload ↔ dokumen baru) tidak dibawa; dokumen berisi dikonfirmasi dulu
              if (form.uploadId && office !== officeSource && sessionUploads.current.has(form.uploadId)) {
                if (sessionOfficeDoc && !(await officeDiscard.confirm(form.uploadId))) return;
                dropSessionUpload();
              }
              setFileSource(office ? "office" : "upload");
              patch({ type: office ? "file" : v });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link">Web Link</SelectItem>
              <SelectItem value="file">File</SelectItem>
              {/* Dokumen baru hanya untuk resource baru (resource lama sudah punya berkas) */}
              {officeEnabled && !resource && (
                <SelectItem value={OFFICE_ATTACHMENT_TYPE}>{OFFICE_ATTACHMENT_LABEL}</SelectItem>
              )}
              <SelectItem value="note">Catatan / List</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor="res-title">Nama Resource</FieldLabel>
          <Input
            id="res-title"
            placeholder="Judul dokumen..."
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
      </div>

      {filed && (
        <p className="rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          {archiveLockReason(resource)} Tipe dan berkas dikunci; nama, tanggal, tag, dan deskripsi tetap bisa diubah.
        </p>
      )}
      {form.type === "link" && (
        <Field>
          <FieldLabel htmlFor="res-url">URL / Link</FieldLabel>
          <Input
            id="res-url"
            placeholder="https://..."
            value={form.url ?? ""}
            onChange={(e) => patch({ url: e.target.value })}
          />
        </Field>
      )}
      {form.type === "file" && (
        <Field>
          <FieldLabel>{officeSource ? "Jenis dokumen baru" : "Upload File"}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            {!officeSource ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploading || filed}
                  title={filed ? "Dokumen arsip yang sudah diberkaskan tidak bisa diganti" : undefined}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? <Spinner /> : <Upload />} {form.uploadId ? "Ganti File" : "Pilih File"}
                </Button>
                {/* Hasil Markdown Converter dipanggil ke Working Space sebagai salinan berkas .md */}
                {!filed && <ConvertedDocumentPicker disabled={uploading} onPick={(file) => void handleFile(file)} />}
              </>
            ) : (
              !form.uploadId && (
                <NewOfficeDocumentPicker
                  title={form.title}
                  context="resource"
                  ownerId={uploadOwnerId}
                  onCreated={(asset) => {
                    lastFileRef.current = null;
                    const title = form.title.trim() || asset.originalName.replace(/\.[a-z0-9]+$/i, "");
                    acceptAsset(asset, title);
                    editInOffice(asset.id, title);
                  }}
                />
              )
            )}
            <span className="flex items-center gap-2">
              <Checkbox
                id="res-ai-summary"
                checked={aiSummary}
                onCheckedChange={(checked) => toggleAiSummary(checked === true)}
              />
              <Label htmlFor="res-ai-summary" className="text-xs font-normal text-muted-foreground">
                Ringkas dengan AI
              </Label>
              {aiSummary && <SummaryStatusBadge status={summarizer.status} />}
            </span>
            <span className="flex items-center gap-2">
              <Checkbox
                id="res-file-control"
                checked={toFileControl || filed}
                disabled={filed}
                onCheckedChange={(checked) => toggleFileControl(checked === true)}
              />
              <Label htmlFor="res-file-control" className="text-xs font-normal text-muted-foreground">
                <Archive className="size-3.5" /> Masukkan ke File Control
                {filed && " (sudah diberkaskan)"}
              </Label>
            </span>
            {form.uploadId && (
              <span className="truncate text-xs text-muted-foreground">
                {officeSource ? "Dokumen dibuat" : "File saat ini"}: {form.title}
              </span>
            )}
            {form.uploadId && !filed && officeEnabled && isOfficeEditable(form.title, form.mimeType) && (
              <Button type="button" variant="ghost" size="xs" onClick={() => editInOffice(form.uploadId!, form.title)}>
                <FilePen /> Edit di ONLYOFFICE
              </Button>
            )}
            {sessionOfficeDoc && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-destructive"
                onClick={() => void deleteOfficeDoc()}
              >
                <Trash2 /> Hapus dokumen
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </Field>
      )}
      {form.type === "note" && (
        <Field>
          <FieldLabel>Pilih Catatan / List</FieldLabel>
          <SearchableSelect
            groups={noteGroups}
            value={form.noteId}
            onChange={selectNote}
            placeholder="Cari & pilih catatan/list..."
          />
        </Field>
      )}

      <Field className="md:w-1/2">
        <FieldLabel htmlFor="res-date">Tanggal</FieldLabel>
        <Input id="res-date" type="date" value={form.date ?? ""} onChange={(e) => patch({ date: e.target.value })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="res-tags">Tag</FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Otomatis:
          {contextTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-muted-foreground">
              {tag}
            </Badge>
          ))}
        </div>
        <TagInput
          id="res-tags"
          value={freeTags}
          suggestions={tagSuggestions}
          maxLength={MAX_TAG_LENGTH}
          placeholder="Tambah tag, mis. Regulasi, SOP..."
          onAdd={(input) => setFreeTags((prev) => addFreeTag(prev, input, tagSuggestions))}
          onRemove={(tag) => setFreeTags((prev) => prev.filter((t) => t !== tag))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="res-content">Deskripsi</FieldLabel>
        <Textarea
          id="res-content"
          rows={3}
          value={form.content ?? ""}
          onChange={(e) => patch({ content: e.target.value })}
        />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button onClick={save} disabled={uploading}>
          Simpan
        </Button>
      </DialogFooter>
    </FieldGroup>
  );
}
