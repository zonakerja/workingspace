import {
  BookMarked,
  CalendarDays,
  Mails,
  FileText,
  FolderArchive,
  Layers,
  type LucideIcon,
  ScanSearch,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Link, useNavigate } from "react-router";
import { previewFile } from "@/components/common/file-preview";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSmartSearch } from "@/data/use-smart-search";
import { openKnowledgeNote } from "@/features/knowledge/knowledge-note-dialog";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { SmartModule, SmartSearchMode, SmartSearchResult } from "@/types/api";
import { highlightParts, kindLabel, MODULE_INFO, moduleCounts, smartTarget } from "./smart-search-utils";
import { Lock } from "lucide-react";
import { requestUnlock } from "@/features/security/pin-prompt";

const MODULE_ICON: Record<SmartModule, LucideIcon> = {
  planner: CalendarDays,
  email: Mails,
  notes: StickyNote,
  "working-space": Layers,
  file_control: FolderArchive,
  files: FileText,
  knowledge: BookMarked,
  other: FileText,
};

/**
 * Pencarian Pintar: menemukan item & isi berkas di semua modul lewat indeks pengetahuan, tanpa menulis jawaban
 * (itu tugas chatbot). Mode Kata dicari saat mengetik tanpa biaya AI; mode Makna dicari saat Enter (satu embedding).
 */
export function SmartSearchPanel({
  query,
  mode,
  submitted,
  onMode,
  onClose,
}: {
  query: string;
  mode: SmartSearchMode;
  /** Kueri yang sudah dikirim dengan Enter (dipakai mode Makna) */
  submitted: string;
  onMode: (mode: SmartSearchMode) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [debounced, setDebounced] = useState(query);
  const [filter, setFilter] = useState<SmartModule | "all">("all");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const active = mode === "meaning" ? submitted : debounced;
  const { data, isFetching, error } = useSmartSearch(active, mode);
  const results = active.trim().length >= 2 ? (data?.results ?? []) : [];
  const counts = moduleCounts(results);
  const shown = filter === "all" ? results : results.filter((r) => r.module === filter);
  const waitingEnter = mode === "meaning" && query.trim().length >= 2 && query.trim() !== submitted.trim();

  const open = async (result: SmartSearchResult) => {
    const target = smartTarget(result);
    if (target.kind === "none") return;
    // Item terkunci: minta PIN dulu, lalu buka (data dimuat ulang utuh)
    if (result.locked && !(await requestUnlock(`"${result.title}" terkunci.`))) return;
    onClose();
    if (target.kind === "knowledge") openKnowledgeNote(target.noteId);
    else if (target.kind === "file")
      previewFile({
        uploadId: target.uploadId,
        name: target.name,
        ...(target.mimeType ? { mimeType: target.mimeType } : {}),
      });
    else void navigate(target.path);
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(value) => value && onMode(value as SmartSearchMode)}
          aria-label="Cara mencari"
        >
          <ToggleGroupItem value="text" title="Cari kata & awalan kata saat mengetik, tanpa AI">
            <ScanSearch /> Kata
          </ToggleGroupItem>
          <ToggleGroupItem value="meaning" title="Cari menurut makna saat Enter (memakai satu embedding)">
            <Sparkles /> Makna
          </ToggleGroupItem>
        </ToggleGroup>
        {counts.length > 1 && (
          <>
            <FilterChip
              label="Semua"
              count={results.length}
              selected={filter === "all"}
              onClick={() => setFilter("all")}
            />
            {counts.map(({ module, count }) => (
              <FilterChip
                key={module}
                label={MODULE_INFO[module].label}
                count={count}
                selected={filter === module}
                onClick={() => setFilter(filter === module ? "all" : module)}
              />
            ))}
          </>
        )}
        {isFetching && <Spinner className="ml-auto size-4 text-muted-foreground" />}
      </div>

      {data && !data.indexEnabled ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
          <ScanSearch className="size-10 opacity-40" />
          <p>
            Pencarian Pintar memakai <b>Indeks Pengetahuan</b>, yang sedang dimatikan.
            <br />
            Sementara itu, gunakan tab <b>Cepat</b>.
          </p>
          <Button asChild size="sm" variant="outline" onClick={onClose}>
            <Link to="/tools/index">Buka Tools → Indeks Pengetahuan</Link>
          </Button>
        </div>
      ) : query.trim().length < 2 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
          <ScanSearch className="size-10 opacity-40" />
          <p>
            Cari item <b>dan isi berkas</b> di Planner, Notes, Working Space, File Control, dan Knowledge.
            <br />
            {mode === "meaning"
              ? "Mode Makna: tulis maksud Anda, lalu tekan Enter."
              : "Mode Kata: hasil muncul saat mengetik, termasuk nomor surat & nama berkas."}
          </p>
        </div>
      ) : waitingEnter ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Tekan Enter untuk mencari menurut makna.</p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">{errorMessage(error)}</p>
      ) : data && results.length === 0 && !isFetching ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Tidak ada hasil untuk “{active.trim()}”.
          {mode === "text" && " Coba mode Makna."}
        </p>
      ) : (
        <CommandGroup className="p-0">
          {mode === "meaning" && data && !data.semantic && (
            <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              Pencarian makna butuh model Embedding di Akai (Pengaturan → Model AI). Yang tampil adalah hasil pencarian
              kata.
            </div>
          )}
          {shown.map((result) => (
            <ResultRow
              key={`${result.sourceType}:${result.sourceId}`}
              result={result}
              query={active}
              onOpen={() => void open(result)}
            />
          ))}
        </CommandGroup>
      )}

      {results.length > 0 && (
        <p className="px-2 pt-1 text-[11px] text-muted-foreground">
          ↑ ↓ memilih hasil, Enter membuka. Isi berkas hanya dicari pada data milik Anda; item yang dibagikan orang lain
          dicocokkan dari judul & keterangannya.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted",
        selected && "border-module bg-module-soft font-semibold text-module",
      )}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-warning/25 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function ResultRow({ result, query, onOpen }: { result: SmartSearchResult; query: string; onOpen: () => void }) {
  const info = MODULE_INFO[result.module];
  const Icon = MODULE_ICON[result.module];
  const disabled = smartTarget(result).kind === "none";
  return (
    <CommandItem
      value={`smart-${result.sourceType}:${result.sourceId}`}
      disabled={disabled}
      onSelect={onOpen}
      className="items-start gap-3 rounded-xl px-2 py-2"
    >
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted", info.tone)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">
            <Highlighted text={result.title} query={query} />
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {kindLabel(result)}
          </span>
        </span>
        {result.locked && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <Lock className="size-3" /> Terkunci — masukkan PIN untuk melihat isinya
          </span>
        )}
        {result.snippet && (
          <span className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">
            <Highlighted text={result.snippet} query={query} />
          </span>
        )}
        <span className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
          <span className={info.tone}>{info.label}</span>
          {result.path && <span className="truncate">{result.path}</span>}
          {result.matches > 1 && <span>{result.matches} bagian cocok</span>}
        </span>
      </span>
    </CommandItem>
  );
}
