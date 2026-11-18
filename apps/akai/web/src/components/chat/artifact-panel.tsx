import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  ImageIcon,
  Loader2,
  Network,
  PanelsTopLeft,
  Presentation,
  Shapes,
  Sheet,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_LABELS, type ExportFormat, exportFormats } from "@/lib/artifact-formats";
import { type Artifact, type ArtifactType, type ArtifactVersion, TYPE_LABELS } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { ArtifactCode, ArtifactPreview } from "./artifact-preview";

export const ARTIFACT_ICONS: Record<ArtifactType, typeof FileText> = {
  markdown: FileText,
  html: PanelsTopLeft,
  svg: ImageIcon,
  mermaid: Network,
  code: FileCode2,
  sheet: Sheet,
  slides: Presentation,
  whiteboard: Shapes,
};

/** Kartu artifact di dalam jawaban; klik = buka di panel. */
export function ArtifactCard({
  artifact,
  version,
  active,
  onOpen,
}: {
  artifact: Artifact;
  version: number;
  active: boolean;
  onOpen: () => void;
}) {
  const Icon = ARTIFACT_ICONS[artifact.type];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "my-2 flex w-full max-w-md items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm",
        active && "border-primary ring-1 ring-primary/30",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {artifact.complete ? <Icon className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{artifact.title}</span>
        <span className="block text-xs text-muted-foreground">
          {artifact.complete ? `${TYPE_LABELS[artifact.type]} · versi ${version}` : "Sedang ditulis…"}
        </span>
      </span>
    </button>
  );
}

/** Panel artifact: Pratinjau / Kode, pindah versi, salin, unduh, tutup. */
export function ArtifactPanel({
  versions,
  version,
  onVersion,
  onClose,
}: {
  versions: ArtifactVersion[];
  version: number;
  onVersion: (version: number) => void;
  onClose: () => void;
}) {
  const current = versions[Math.min(version, versions.length) - 1];
  const artifact: Artifact | undefined = current?.artifact;
  const [view, setView] = useState<"preview" | "code">(artifact?.type === "code" ? "code" : "preview");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  if (!artifact) return null;
  const Icon = ARTIFACT_ICONS[artifact.type];
  const codeOnly = artifact.type === "code";

  async function runExport(format: ExportFormat) {
    if (!artifact) return;
    setExporting(format);
    try {
      // Pustaka ekspor (DOCX, XLSX, PPTX) dimuat hanya saat dipakai
      const { exportArtifact } = await import("@/lib/artifact-export");
      await exportArtifact(artifact, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ekspor gagal.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{artifact.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {TYPE_LABELS[artifact.type]}
            {artifact.language ? ` · ${artifact.language}` : ""}
            {artifact.complete ? "" : " · sedang ditulis…"}
          </p>
        </div>
        {versions.length > 1 && (
          <div className="flex items-center text-xs text-muted-foreground">
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={version <= 1}
              onClick={() => onVersion(version - 1)}
              aria-label="Versi sebelumnya"
            >
              <ChevronLeft />
            </Button>
            <span className="px-1 tabular-nums">
              v{version}/{versions.length}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={version >= versions.length}
              onClick={() => onVersion(version + 1)}
              aria-label="Versi berikutnya"
            >
              <ChevronRight />
            </Button>
          </div>
        )}
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Tutup artifact">
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        {!codeOnly && (
          <>
            <Button size="xs" variant={view === "preview" ? "secondary" : "ghost"} onClick={() => setView("preview")}>
              <Eye data-icon="inline-start" /> Pratinjau
            </Button>
            <Button size="xs" variant={view === "code" ? "secondary" : "ghost"} onClick={() => setView("code")}>
              <Code2 data-icon="inline-start" /> Kode
            </Button>
          </>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={!artifact.complete}
            onClick={() => {
              void navigator.clipboard.writeText(artifact.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} Salin
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" disabled={!artifact.complete || exporting !== null}>
                {exporting ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {artifact.type === "code" ? "Unduh" : "Ekspor"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Unduh sebagai</DropdownMenuLabel>
              {exportFormats(artifact.type).map((format) => (
                <DropdownMenuItem key={format} onSelect={() => void runExport(format)}>
                  {EXPORT_LABELS[format]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {view === "code" || codeOnly ? <ArtifactCode artifact={artifact} /> : <ArtifactPreview artifact={artifact} />}
      </div>
    </div>
  );
}
