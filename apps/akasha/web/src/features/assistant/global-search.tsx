import {
  BookOpen,
  Bot,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Layers,
  type LucideIcon,
  RefreshCw,
  ScanSearch,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeFrequency, scheduleStart } from "@/features/planner/lib/planner-logic";
import { links } from "@/lib/deep-links";
import type { SmartSearchMode } from "@/types/api";
import { type AkashaData, useAkashaData } from "./akasha-context";
import { SmartSearchPanel } from "./smart-search-panel";

interface SearchResult {
  key: string;
  type: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  path: string;
}

/** Data yang hanya berisi item yang dibagikan orang lain (bertanda `share`) — dicari di tab Pintar. */
const sharedOnly = (data: AkashaData): AkashaData =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter((item) => !!(item as { share?: unknown } | null)?.share) : value,
    ]),
  ) as unknown as AkashaData;

/** Pencarian cepat lintas modul (maks. 15 hasil). */
const searchAll = (data: AkashaData, query: string): SearchResult[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (s?: string | null) => !!s && s.toLowerCase().includes(q);
  const results: SearchResult[] = [];

  data.projects.forEach((p) => {
    if (has(p.title) || has(p.description))
      results.push({
        key: `p-${p.id}`,
        type: "Project",
        title: p.title,
        desc: p.deadline ? `Deadline: ${p.deadline}` : "No deadline",
        icon: Layers,
        color: "text-mod-working-space",
        path: links.project(p.id),
      });
  });
  data.projectTasks.forEach((t) => {
    if (has(t.title) || has(t.description))
      results.push({
        key: `t-${t.id}`,
        type: "Task",
        title: t.title,
        desc: `Prioritas: ${t.priority ?? "-"}`,
        icon: CheckSquare,
        color: "text-success",
        path: links.task(t.id),
      });
  });
  data.schedules.forEach((s) => {
    if (has(s.title) || has(s.location))
      results.push({
        key: `s-${s.id}`,
        type: "Agenda",
        title: s.title,
        desc: `Tgl: ${scheduleStart(s)}`,
        icon: CalendarDays,
        color: "text-mod-planner",
        path: links.schedule(s.id),
      });
  });
  data.todos.forEach((t) => {
    if (has(t.title))
      results.push({
        key: `td-${t.id}`,
        type: "To-Do",
        title: t.title,
        desc: t.completed ? "Selesai" : "Belum Selesai",
        icon: CheckCircle2,
        color: "text-info",
        path: links.todo(t.id),
      });
  });
  data.routines.forEach((r) => {
    if (has(r.title))
      results.push({
        key: `r-${r.id}`,
        type: "Rutinitas",
        title: r.title,
        desc: `Frekuensi: ${describeFrequency(r)}`,
        icon: RefreshCw,
        color: "text-mod-notes",
        path: links.routineEdit(r.id),
      });
  });
  data.freeNotes.forEach((n) => {
    if (has(n.title) || has(n.content))
      results.push({
        key: `fn-${n.id}`,
        type: "Catatan",
        title: n.title,
        desc: `${n.content?.substring(0, 50) ?? ""}...`,
        icon: StickyNote,
        color: "text-warning",
        path: links.note("free", n.id),
      });
  });
  data.aiNotes.forEach((n) => {
    if (has(n.title) || has(n.aiSummary))
      results.push({
        key: `an-${n.id}`,
        type: "AI Note",
        title: n.title,
        desc: "Catatan Pintar",
        icon: Bot,
        color: "text-mod-overview",
        path: links.note("ai", n.id),
      });
  });
  data.resources.forEach((r) => {
    if (has(r.title))
      results.push({
        key: `res-${r.id}`,
        type: "Resource",
        title: r.title,
        desc: String(r.type ?? ""),
        icon: BookOpen,
        color: "text-mod-files",
        path: links.resource(r.id),
      });
  });
  return results.slice(0, 15);
};

/** Tombol header + dialog Global Search (Ctrl/⌘+K). */
export function GlobalSearchButton() {
  const [open, setOpen] = useState(false);

  // Shortcut keyboard global
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden w-56 justify-between text-muted-foreground md:flex"
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2">
          <Search /> Cari...
        </span>
        <Kbd>Ctrl K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Cari" onClick={() => setOpen(true)}>
        <Search />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[10svh] flex max-h-[80svh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">Pencarian Global</DialogTitle>
          <DialogDescription className="sr-only">Cari item dan isi berkas di seluruh Akasha.</DialogDescription>
          <GlobalSearchPanel onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function GlobalSearchPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const data = useAkashaData();
  const [mode, setMode] = useState<"standard" | "smart">("standard");
  const [smartMode, setSmartMode] = useState<SmartSearchMode>("text");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const results = mode === "standard" ? searchAll(data, query) : [];
  // Indeks pengetahuan hanya berisi data milik sendiri → item yang dibagikan orang lain dicari di browser
  const sharedResults = mode === "smart" && query.trim().length >= 2 ? searchAll(sharedOnly(data), query) : [];
  const openResult = (r: SearchResult) => {
    onClose();
    void navigate(r.path);
  };

  return (
    <Command shouldFilter={false} className="rounded-none" data-module="overview">
      <div className="flex items-center gap-2 border-b pr-2">
        <div className="flex-1">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              mode === "standard"
                ? "Cari Project, Tugas, Catatan, Agenda..."
                : smartMode === "meaning"
                  ? "Tulis maksud Anda (cth: surat penghapusan kendaraan dinas), lalu Enter"
                  : "Cari item & isi berkas di semua modul..."
            }
            onKeyDown={(e) => {
              // Mode Makna: Enter pertama mengirim kueri; Enter berikutnya (kueri sama) membuka hasil terpilih
              if (
                e.key === "Enter" &&
                mode === "smart" &&
                smartMode === "meaning" &&
                query.trim() !== submitted.trim()
              ) {
                e.preventDefault();
                setSubmitted(query);
              }
            }}
          />
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "standard" | "smart")}>
          <TabsList>
            <TabsTrigger value="standard">Cepat</TabsTrigger>
            <TabsTrigger value="smart" title="Cari item & isi berkas di semua modul">
              <ScanSearch /> Pintar
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Tutup pencarian">
            <X />
          </Button>
        </DialogClose>
      </div>

      <CommandList className="max-h-none flex-1 overflow-y-auto p-2">
        {mode === "standard" &&
          (!query ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
              <Search className="size-10 opacity-40" />
              Ketik sesuatu untuk mencari di seluruh aplikasi...
            </div>
          ) : (
            <>
              <CommandEmpty>
                Tidak menemukan hasil untuk "{query}". Coba tab Pintar (ikut mencari isi berkas).
              </CommandEmpty>
              <CommandGroup>
                {results.map((r) => (
                  <CommandItem
                    key={r.key}
                    value={r.key}
                    onSelect={() => openResult(r)}
                    className="gap-3 rounded-xl py-3"
                  >
                    <QuickResultContent result={r} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ))}

        {mode === "smart" && (
          <SmartSearchPanel
            query={query}
            mode={smartMode}
            submitted={submitted}
            onMode={(next) => {
              setSmartMode(next);
              if (next === "meaning") setSubmitted(query);
            }}
            onClose={onClose}
          />
        )}
        {mode === "smart" && sharedResults.length > 0 && (
          <CommandGroup heading="Dibagikan kepada Anda">
            {sharedResults.map((r) => (
              <CommandItem
                key={`shared-${r.key}`}
                value={`shared-${r.key}`}
                onSelect={() => openResult(r)}
                className="gap-3 rounded-xl py-2"
              >
                <QuickResultContent result={r} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function QuickResultContent({ result: r }: { result: SearchResult }) {
  return (
    <>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${r.color}`}>
        <r.icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{r.desc}</span>
      </span>
      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
        {r.type}
      </span>
    </>
  );
}
