import {
  Archive,
  Bot,
  CalendarDays,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe,
  type LucideIcon,
  NotebookPen,
  PencilLine,
  Presentation,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isInFileControl } from "@/features/resources/file-control-intake";
import { isContextTag, resourceTags } from "@/features/resources/resource-tags";
import { CommentsButton } from "@/features/sharing/comments-panel";
import { ShareButton } from "@/features/sharing/share-dialog";
import { SharedBadge } from "@/features/sharing/shared-badge";
import { DocumentLinkBadge } from "@/features/tools/onlyoffice/document-links";
import { LockToggleButton, LockedBadge } from "@/features/security/lock-controls";
import { formatShortDate, parseLocalYMD } from "@/lib/dates";
import { itemAccess } from "@/lib/sharing";
import { cn } from "@/lib/utils";
import type { Resource } from "@/types/entities";
import { fileExtension, linkHost, type ResourceKind, resourceKind } from "../lib/resource-view";

type OfficeLinkBadge = { draftId: string | null; finals: number };

/** Ikon, label, dan warna (token) per jenis resource. */
export const KIND_STYLE: Record<ResourceKind, { icon: LucideIcon; label: string; tone: string; band: string }> = {
  pdf: { icon: FileText, label: "PDF", tone: "bg-destructive/12 text-destructive", band: "from-destructive/15" },
  doc: { icon: FileText, label: "Dokumen", tone: "bg-info/12 text-info", band: "from-info/15" },
  sheet: { icon: FileSpreadsheet, label: "Spreadsheet", tone: "bg-success/12 text-success", band: "from-success/15" },
  slide: { icon: Presentation, label: "Presentasi", tone: "bg-warning/15 text-warning", band: "from-warning/15" },
  image: { icon: FileImage, label: "Gambar", tone: "bg-mod-notes/15 text-mod-notes", band: "from-mod-notes/15" },
  media: { icon: FileAudio, label: "Audio/Video", tone: "bg-mod-agent/15 text-mod-agent", band: "from-mod-agent/15" },
  archive: { icon: FileArchive, label: "Arsip zip", tone: "bg-mod-files/15 text-mod-files", band: "from-mod-files/15" },
  file: { icon: File, label: "Berkas", tone: "bg-muted text-muted-foreground", band: "from-muted" },
  link: { icon: Globe, label: "Web Link", tone: "bg-mod-planner/15 text-mod-planner", band: "from-mod-planner/15" },
  note: {
    icon: NotebookPen,
    label: "Catatan",
    tone: "bg-mod-knowledge/15 text-mod-knowledge",
    band: "from-mod-knowledge/15",
  },
};

/** Label tanggal YMD dibaca lokal ("8 Okt 2026"). */
const dateLabel = (ymd?: string) => {
  return ymd ? formatShortDate(parseLocalYMD(ymd)) : "";
};

/** Keterangan kecil di bawah judul: host link, ekstensi berkas, atau jenis catatan. */
const subtitleOf = (res: Resource, kind: ResourceKind) => {
  if (kind === "link") return linkHost(res.url) || "Tautan web";
  if (kind === "note") {
    const prefix = res.noteId?.split("-")[0];
    return prefix === "ai" ? "Notes AI" : prefix === "list" ? "List Bebas" : "Catatan Bebas";
  }
  const ext = fileExtension(res.title);
  return ext ? `.${ext.toUpperCase()}` : KIND_STYLE[kind].label;
};

export interface ResourceViewProps {
  items: Resource[];
  highlightId?: string | null;
  linkBadges?: Record<string, OfficeLinkBadge | undefined>;
  canEdit: boolean;
  onOpen: (res: Resource) => void;
  onAi: (res: Resource) => void;
  onEdit: (res: Resource) => void;
  onArchive: (res: Resource) => void;
  onDelete: (res: Resource) => void;
  /** Kunci / lepas kunci PIN (pemilik) */
  onSaveLock: (next: Resource) => void;
}

/** Kotak ikon berwarna sesuai jenis resource. */
function KindIcon({ kind, className }: { kind: ResourceKind; className?: string }) {
  const style = KIND_STYLE[kind];
  const Icon = style.icon;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-xl", style.tone, className)}>
      <Icon className="size-[55%]" />
    </span>
  );
}

function TagList({ res, max }: { res: Resource; max?: number }) {
  const tags = resourceTags(res);
  // Tag bebas (kategori isi) lebih dulu, tag otomatis (asal) sesudahnya
  const sorted = [...tags.filter((t) => !isContextTag(t)), ...tags.filter(isContextTag)];
  const shown = max ? sorted.slice(0, max) : sorted;
  const hidden = sorted.length - shown.length;
  if (!sorted.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {shown.map((tag) =>
        isContextTag(tag) ? (
          <Badge key={tag} variant="outline" className="text-muted-foreground" title="Tag otomatis (asal)">
            {tag}
          </Badge>
        ) : (
          <Badge key={tag} className="bg-module-soft text-module" title="Tag">
            #{tag}
          </Badge>
        ),
      )}
      {hidden > 0 && (
        <Badge variant="outline" className="text-muted-foreground" title={sorted.slice(shown.length).join(", ")}>
          +{hidden}
        </Badge>
      )}
    </div>
  );
}

function StatusBadges({ res, link }: { res: Resource; link?: OfficeLinkBadge }) {
  return (
    <>
      <LockedBadge item={res} />
      {res.uploadId && <DocumentLinkBadge link={link} />}
      {isInFileControl(res) && (
        <Badge className="bg-mod-files/15 text-mod-files" title="Dikelola di File Control">
          <Archive /> File Control
        </Badge>
      )}
    </>
  );
}

function RowActions({
  res,
  canEdit,
  onAi,
  onEdit,
  onArchive,
  onDelete,
  onSaveLock,
}: Omit<ResourceViewProps, "items" | "onOpen"> & { res: Resource }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        title={res.aiSummary ? "Ringkasan AI" : "Buat ringkasan AI"}
        className={cn(res.aiSummary && "bg-module-soft text-module")}
        onClick={() => onAi(res)}
      >
        <Bot />
      </Button>
      <CommentsButton recordType="para_resource" item={res} title={res.title} />
      {canEdit && itemAccess(res).canEdit && (
        <Button variant="ghost" size="icon-sm" title="Ubah" onClick={() => onEdit(res)}>
          <PencilLine />
        </Button>
      )}
      {/* Bagikan, arsipkan, hapus hanya oleh pemilik */}
      {canEdit && !res.share && (
        <>
          {/* Arsip File Control tidak dikunci PIN (prosedur kearsipan butuh isinya) */}
          {(res.locked || !isInFileControl(res)) && <LockToggleButton item={res} onSave={onSaveLock} />}
          <ShareButton item={res} recordType="para_resource" title={res.title} iconOnly />
          <Button
            variant="ghost"
            size="icon-sm"
            title="Arsipkan"
            className="hover:text-warning"
            onClick={() => onArchive(res)}
          >
            <Archive />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Hapus"
            className="hover:text-destructive"
            onClick={() => onDelete(res)}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );
}

/** Tampilan kartu: ikon jenis besar, judul, deskripsi/ringkasan, tag, tanggal, aksi. */
export function ResourceGrid(props: ResourceViewProps) {
  const { items, highlightId, linkBadges, onOpen } = props;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((res) => {
        const kind = resourceKind(res);
        const style = KIND_STYLE[kind];
        const description = res.content?.trim() || res.aiSummary?.trim() || "";
        return (
          <Card
            key={res.id}
            data-item-id={res.id}
            className={cn(
              "group relative gap-0 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md",
              highlightId === res.id && "ring-2 ring-module",
            )}
          >
            <div className={cn("absolute inset-x-0 top-0 h-16 bg-linear-to-b to-transparent", style.band)} />
            <button
              type="button"
              onClick={() => onOpen(res)}
              className="relative flex flex-1 flex-col gap-2.5 p-4 pb-2 text-left"
            >
              <div className="flex items-start gap-3">
                <KindIcon kind={kind} className="size-11 shadow-sm" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug font-semibold wrap-anywhere group-hover:text-module">
                    {res.title || "Tanpa judul"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {res.number && <span className="font-mono">{res.number} · </span>}
                    {subtitleOf(res, kind)}
                  </p>
                </div>
              </div>
              <p
                className={cn(
                  "line-clamp-2 min-h-8 text-xs leading-relaxed",
                  description ? "text-muted-foreground" : "text-muted-foreground/60 italic",
                )}
              >
                {!res.content?.trim() && res.aiSummary?.trim() && (
                  <Sparkles className="mr-1 inline size-3 text-module" />
                )}
                {res._locked ? "Isi terkunci — masukkan PIN untuk membuka." : description || "Belum ada deskripsi."}
              </p>
            </button>
            <div className="relative flex flex-col gap-2 px-4 pb-1">
              <div className="flex flex-wrap gap-1">
                <SharedBadge item={res} recordType="para_resource" />
                <StatusBadges res={res} link={res.uploadId ? linkBadges?.[res.uploadId] : undefined} />
              </div>
              <TagList res={res} max={3} />
            </div>
            <div className="relative mt-auto flex items-center justify-between gap-2 border-t px-3 py-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {dateLabel(res.date) || "-"}
              </span>
              <RowActions res={res} {...props} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Tampilan tabel padat: ikon jenis + judul + deskripsi dalam satu kolom. */
export function ResourceTable(props: ResourceViewProps) {
  const { items, highlightId, linkBadges, onOpen } = props;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[44%]">Resource</TableHead>
            <TableHead>Jenis</TableHead>
            <TableHead>Tanggal</TableHead>
            <TableHead>Tag</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((res) => {
            const kind = resourceKind(res);
            const description = res.content?.trim() || res.aiSummary?.trim() || "";
            return (
              <TableRow
                key={res.id}
                data-item-id={res.id}
                className={cn("group", highlightId === res.id && "bg-module-soft")}
              >
                <TableCell className="max-w-0 min-w-64">
                  <div className="flex items-center gap-3">
                    <KindIcon kind={kind} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpen(res)}
                        className="block max-w-full truncate text-left font-semibold group-hover:text-module hover:underline"
                      >
                        {res.title || "Tanpa judul"}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">
                        {res.number && <span className="font-mono">{res.number} · </span>}
                        {description || subtitleOf(res, kind)}
                      </p>
                      <SharedBadge item={res} recordType="para_resource" className="mt-1" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{KIND_STYLE[kind].label}</Badge>
                    <StatusBadges res={res} link={res.uploadId ? linkBadges?.[res.uploadId] : undefined} />
                  </div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {dateLabel(res.date) || "-"}
                </TableCell>
                <TableCell className="max-w-56">
                  <TagList res={res} max={4} />
                </TableCell>
                <TableCell>
                  <RowActions res={res} {...props} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
