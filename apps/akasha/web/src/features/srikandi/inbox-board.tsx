import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  Inbox,
  ListTodo,
  Loader2,
  MailOpen,
  Reply,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { PaginationControl } from "@/components/common/pagination-control";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSrikandiInbox, useSrikandiOutgoings, useTodos } from "@/data/collections";
import { queryKeys } from "@/data/query-keys";
import { useRobotConnectors } from "@/data/use-robot";
import { usePagination } from "@/hooks/use-pagination";
import { useSearchParam } from "@/hooks/use-search-param";
import { useToday } from "@/hooks/use-today";
import { errorMessage } from "@/lib/api/client";
import { robotApi } from "@/lib/api/endpoints";
import { formatDateTime, formatShortDate, parseLocalYMD } from "@/lib/dates";
import { links } from "@/lib/deep-links";
import { generateId } from "@/lib/ids";
import { toExternalHref } from "@/lib/urls";
import { cn } from "@/lib/utils";
import type { SrikandiInbox } from "@/types/entities";
import {
  canReply,
  filterInbox,
  INBOX_KIND_LABELS,
  INBOX_KINDS,
  INBOX_PATHS,
  inboxCounts,
  type InboxFilter,
  inboxTitle,
  isFollowedUp,
  isUnread,
  todoFromInbox,
} from "./inbox-logic";

const KIND_STYLE: Record<SrikandiInbox["kind"], string> = {
  masuk: "bg-info/12 text-info",
  tembusan: "bg-muted text-muted-foreground",
  disposisi: "bg-warning/15 text-warning",
  koordinasi: "bg-module-soft text-module",
  arahan: "bg-success/12 text-success",
};

const shortDate = (ymd?: string) => (ymd ? formatShortDate(parseLocalYMD(ymd)) : "");

/**
 * SRIKANDI → Naskah Masuk: surat yang ditujukan ke Anda, tembusan, disposisi, koordinasi, dan arahan yang diambil robot
 * dari halaman daftar SRIKANDI (hanya membaca; detail tidak dibuka sehingga status baca di SRIKANDI tidak berubah).
 * Tindak lanjut di Akasha: jadikan to-do Planner, atau buat entri Register sebagai balasan.
 */
export function InboxBoard() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = useToday();
  const { items, upsert } = useSrikandiInbox();
  const { upsert: upsertTodo } = useTodos();
  const { data: connectors } = useRobotConnectors();
  const { items: registers } = useSrikandiOutgoings();
  const replyOf = new Map(registers.filter((r) => r.replyTo).map((r) => [r.replyTo!, r]));
  const [highlight, setHighlight] = useSearchParam("inbox");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  const base = (connectors?.find((c) => c.system === "srikandi")?.baseUrl ?? "https://srikandi.arsip.go.id").replace(
    /\/+$/,
    "",
  );
  const counts = inboxCounts(items);
  const list = filterInbox(items, filter, search);
  // Butir yang disorot dari tautan (notifikasi, pencarian, chatbot) ditaruh paling atas
  const ordered = highlight
    ? [...list.filter((i) => i.id === highlight), ...list.filter((i) => i.id !== highlight)]
    : list;
  const { pageItems, setPage, controlProps } = usePagination(ordered, 10);
  const lastSync = items
    .map((i) => i.syncedAt ?? "")
    .sort()
    .at(-1);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await robotApi.syncInbox();
      await client.invalidateQueries({ queryKey: queryKeys.records("srikandi_inbox") });
      toast.success(r.total ? `${r.total} naskah terbaca dari SRIKANDI.` : "Tidak ada naskah masuk di SRIKANDI.", {
        description: r.added ? `${r.added} baru (${r.newUnread} belum dibaca).` : r.summary,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  const makeTodo = (item: SrikandiInbox) => {
    const todo = todoFromInbox(item, generateId("todo"), today);
    upsertTodo(todo);
    upsert({ ...item, todoId: todo.id });
    toast.success("To-do dibuat di Planner (hari ini).", {
      action: { label: "Buka", onClick: () => void navigate(links.todo(todo.id)) },
    });
  };

  const chips: { id: InboxFilter; label: string }[] = [
    { id: "all", label: "Semua" },
    { id: "unread", label: "Belum dibaca" },
    ...INBOX_KINDS.map((k) => ({ id: k as InboxFilter, label: INBOX_KIND_LABELS[k] })),
  ];

  return (
    <SectionCard
      icon={Inbox}
      title="Naskah Masuk"
      description={
        lastSync
          ? `Diambil dari SRIKANDI ${formatDateTime(lastSync)}. Hanya daftar yang dibaca robot — status baca di SRIKANDI tidak berubah.`
          : "Ambil naskah masuk, tembusan, disposisi, koordinasi, dan arahan dari SRIKANDI. Robot hanya membaca daftar; detail naskah tidak dibuka sehingga status baca tetap."
      }
      action={
        <Button size="sm" onClick={() => void sync()} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <CloudDownload />} Ambil dari SRIKANDI
        </Button>
      }
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Cari nomor, hal, asal, instruksi…"
        />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(v) => {
            if (!v) return;
            setFilter(v as InboxFilter);
            setPage(1);
          }}
          className="flex flex-wrap justify-start"
        >
          {chips.map((c) => (
            <ToggleGroupItem key={c.id} value={c.id} className="h-7 px-2.5 text-xs">
              {c.label}
              <span className="ml-1 text-muted-foreground">{counts[c.id]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {ordered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>{items.length ? "Tidak ada yang cocok" : "Belum ada naskah masuk"}</EmptyTitle>
            <EmptyDescription>
              {items.length
                ? "Ubah kata pencarian atau pilihan jenis."
                : "Klik Ambil dari SRIKANDI. Pastikan sesi SRIKANDI aktif di tab Connector; pengambilan berkala bisa dinyalakan di Connector → Otomasi terjadwal."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {pageItems.map((item) => {
            const unread = isUnread(item);
            const instruction = [item.instruction, item.extraInstruction].filter(Boolean).join(" — ");
            const href = toExternalHref(`${base}${INBOX_PATHS[item.kind]}`);
            return (
              <li
                key={item.id}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start",
                  item.id === highlight && "border-module ring-1 ring-module",
                  unread && "bg-info/5",
                )}
                onClick={() => item.id === highlight && setHighlight(null)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge className={KIND_STYLE[item.kind]}>{INBOX_KIND_LABELS[item.kind]}</Badge>
                    {unread ? (
                      <Badge className="bg-info/15 text-info">Belum dibaca</Badge>
                    ) : item.readStatus ? (
                      <Badge variant="secondary">{item.readStatus}</Badge>
                    ) : null}
                    {item.followUpStatus && (
                      <Badge
                        className={isFollowedUp(item) ? "bg-success/12 text-success" : "bg-warning/15 text-warning"}
                      >
                        {item.followUpStatus}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {item.sentDate
                        ? `${INBOX_KIND_LABELS[item.kind]} ${shortDate(item.sentDate)}${item.date ? ` · naskah ${shortDate(item.date)}` : ""}`
                        : shortDate(item.date)}
                    </span>
                  </div>
                  <p className={cn("mt-1 text-sm break-words", unread ? "font-bold" : "font-semibold")}>
                    {inboxTitle(item)}
                  </p>
                  <p className="mt-0.5 text-xs break-words text-muted-foreground">
                    {[item.number, item.origin && `dari ${item.origin}`].filter(Boolean).join(" · ")}
                  </p>
                  {instruction && (
                    <p className="mt-1 flex gap-1.5 text-xs break-words">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {instruction}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    {item.todoId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-xs text-success"
                        onClick={() => void navigate(links.todo(item.todoId!))}
                      >
                        <CheckCircle2 className="size-3" /> To-do dibuat
                      </Button>
                    )}
                    {replyOf.has(item.id) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-xs text-module"
                        onClick={() => void navigate(links.srikandiRegister(replyOf.get(item.id)!.id))}
                      >
                        <Reply className="size-3" /> Balasan di Register
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {!item.todoId && (
                    <Button size="sm" variant="outline" onClick={() => makeTodo(item)}>
                      <ListTodo /> Jadikan to-do
                    </Button>
                  )}
                  {canReply(item) && !replyOf.has(item.id) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void navigate(links.srikandiRegisterReply(item.id))}
                    >
                      <Reply /> Buat balasan
                    </Button>
                  )}
                  {href && (
                    <Button size="sm" variant="ghost" asChild title="Buka daftarnya di SRIKANDI (tab baru)">
                      <a href={href} target="_blank" rel="noreferrer">
                        <ExternalLink /> SRIKANDI
                      </a>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PaginationControl {...controlProps} />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MailOpen className="size-3.5" /> Isi surat (PDF) belum diambil: membuka detail di SRIKANDI menandai naskah
        sudah dibaca. Buka naskahnya di SRIKANDI.
      </p>
    </SectionCard>
  );
}
