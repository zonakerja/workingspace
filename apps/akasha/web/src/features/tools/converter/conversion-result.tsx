import { Copy, Download, Inbox, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKnowledgeStatus } from "@/data/use-knowledge";
import { errorMessage } from "@/lib/api/client";
import { knowledgeApi } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";
import type { ConverterResult } from "@/types/api";
import { formatCount, formatDuration, inboxTitle, markdownFileName, providerLabel } from "./converter-utils";

/** Batas isi catatan Inbox di server (`InboxNoteDto`). */
const INBOX_MAX_CHARS = 100_000;

/**
 * Hasil konversi: keterangan mesin & token, pilihan versi (dirapikan AI / hasil converter), pratinjau atau Markdown mentah,
 * Salin, Unduh .md, Simpan ke Inbox vault. Dipakai pustaka Dokumen. Pasang dengan `key` per hasil agar
 * pilihan versi kembali ke bawaan.
 */
export function ConversionResultView({
  result,
  title,
  scrollClassName = "max-h-[32rem]",
}: {
  result: ConverterResult;
  /** Judul catatan Inbox / nama berkas unduhan (bawaan dari nama berkas asal). */
  title?: string;
  scrollClassName?: string;
}) {
  const { data: knowledge } = useKnowledgeStatus();
  const [version, setVersion] = useState<"enhanced" | "converter">(result.enhanced ? "enhanced" : "converter");
  const [view, setView] = useState<"preview" | "source">("preview");
  const [savingInbox, setSavingInbox] = useState(false);
  const shown = version === "enhanced" && result.enhanced ? result.enhanced.markdown : result.markdown;
  const baseName = title?.trim() || result.fileName;

  const copy = async () => {
    await navigator.clipboard.writeText(shown);
    toast.success("Markdown disalin.");
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([shown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = markdownFileName(title?.trim() ? `${title.trim()}.md` : result.fileName);
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveToInbox = async () => {
    setSavingInbox(true);
    try {
      const { path } = await knowledgeApi.addToInbox({ title: inboxTitle(baseName), content: shown });
      toast.success("Disimpan ke Inbox Knowledge", { description: path });
    } catch (error) {
      toast.error("Gagal menyimpan ke Inbox", { description: errorMessage(error) });
    } finally {
      setSavingInbox(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge>{result.engine === "docling" ? "Docling" : "MarkItDown"}</Badge>
        <span className="text-muted-foreground">{result.reason}</span>
        {result.pages ? <Badge variant="outline">{result.pages} halaman</Badge> : null}
        <Badge variant="outline">{formatCount(result.chars)} karakter</Badge>
        <Badge variant="outline">{formatDuration(result.durationMs)}</Badge>
        {result.enhanced && (
          <Badge variant="outline">
            <Sparkles /> Dirapikan oleh {providerLabel(result.enhanced.provider)}
            {result.enhanced.model ? ` (${result.enhanced.model})` : ""} · {formatDuration(result.enhanced.durationMs)}{" "}
            · {result.enhanced.parts} bagian
          </Badge>
        )}
      </div>
      {[...result.warnings, ...(result.enhanced?.notes ?? [])].map((warning) => (
        <p key={warning} className="flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          {warning}
        </p>
      ))}
      {result.enhanceError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" />
          Rapikan AI gagal: {result.enhanceError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {result.enhanced && (
            <Tabs value={version} onValueChange={(value) => setVersion(value as "enhanced" | "converter")}>
              <TabsList>
                <TabsTrigger value="enhanced">Dirapikan AI</TabsTrigger>
                <TabsTrigger value="converter">Hasil converter</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Tabs value={view} onValueChange={(value) => setView(value as "preview" | "source")}>
            <TabsList>
              <TabsTrigger value="preview">Pratinjau</TabsTrigger>
              <TabsTrigger value="source">Markdown</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void copy()} disabled={!shown}>
            <Copy /> Salin
          </Button>
          <Button size="sm" variant="outline" onClick={download} disabled={!shown}>
            <Download /> Unduh .md
          </Button>
          {knowledge?.folder && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void saveToInbox()}
              disabled={!shown || savingInbox || shown.length > INBOX_MAX_CHARS}
              title={shown.length > INBOX_MAX_CHARS ? "Lebih dari 100.000 karakter" : undefined}
            >
              {savingInbox ? <Spinner /> : <Inbox />} Simpan ke Inbox
            </Button>
          )}
        </div>
      </div>
      <div className={cn("min-h-24 overflow-y-auto rounded-xl border bg-muted/20 p-3", scrollClassName)}>
        {!shown ? (
          <p className="text-sm text-muted-foreground">Tidak ada teks yang terbaca dari berkas ini.</p>
        ) : view === "preview" ? (
          <Markdown content={shown} className="text-sm" />
        ) : (
          <pre className="font-mono text-xs break-words whitespace-pre-wrap">{shown}</pre>
        )}
      </div>
    </div>
  );
}
