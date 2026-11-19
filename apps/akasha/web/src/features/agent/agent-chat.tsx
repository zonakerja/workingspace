import { useQueryClient } from "@tanstack/react-query";
import {
  BotMessageSquare,
  Copy,
  History,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  SendHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import { RenameDialog } from "@/components/common/rename-dialog";
import { SearchInput } from "@/components/common/search-input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/data/query-keys";
import {
  useAgentConversation,
  useAgentConversationMutations,
  useAgentConversations,
  useAgentRunWatcher,
} from "@/data/use-agent";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSearchParam } from "@/hooks/use-search-param";
import { useToday } from "@/hooks/use-today";
import { errorMessage } from "@/lib/api/client";
import { type AgentChatMessage, type AgentConversationSummary, agentApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { conversationGroups, filterConversations } from "./agent-chat-utils";

/**
 * Chat AI Agent dengan riwayat tersimpan (seperti Claude): daftar percakapan di kiri (disematkan, hari ini, 7 hari,
 * lebih lama), isi percakapan di kanan. Riwayat disimpan server (`agent_conversations` + `agent_runs`), jadi tidak
 * hilang saat halaman dimuat ulang. `?c=<id>` = percakapan yang dibuka. `canSend` false = Hermes mati: riwayat tetap
 * bisa dibaca.
 */
export function AgentChat({ canSend }: { canSend: boolean }) {
  const [current, setCurrent] = useSearchParam("c");
  const wide = useMediaQuery("(min-width: 1024px)");
  const { data: list = [], isLoading: listLoading } = useAgentConversations(true);

  const list$ = (
    <ConversationList
      list={list}
      loading={listLoading}
      current={current}
      onOpen={(id) => setCurrent(id, { replace: false })}
      onNew={() => setCurrent(null, { replace: false })}
    />
  );

  return (
    <div className="grid h-[max(26rem,calc(100svh-15rem))] grid-cols-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {wide && <aside className="flex min-h-0 flex-col rounded-2xl border bg-card">{list$}</aside>}
      <ChatPane
        key={current ?? "new"}
        conversationId={current}
        canSend={canSend}
        onCreated={(id) => setCurrent(id)}
        historyButton={
          wide ? null : (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  <History /> Riwayat
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(20rem,90vw)] flex-col p-0"
              >
                {list$}
              </PopoverContent>
            </Popover>
          )
        }
      />
    </div>
  );
}

function ConversationList({
  list,
  loading,
  current,
  onOpen,
  onNew,
}: {
  list: AgentConversationSummary[];
  loading: boolean;
  current: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const today = useToday();
  const [renaming, setRenaming] = useState<AgentConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<AgentConversationSummary | null>(null);
  const { update, remove } = useAgentConversationMutations();
  const groups = conversationGroups(filterConversations(list, query), today);

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b p-2">
        <Button size="sm" onClick={onNew}>
          <MessageSquarePlus /> Percakapan baru
        </Button>
        {list.length > 5 && (
          <SearchInput value={query} onChange={setQuery} placeholder="Cari percakapan..." className="md:w-full" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground">Memuat riwayat…</p>
        ) : groups.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {query ? "Tidak ada percakapan yang cocok." : "Belum ada percakapan."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase">{group.label}</p>
              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg pr-1 text-sm hover:bg-muted",
                    c.id === current && "bg-module-soft text-module hover:bg-module-soft",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                    title={`${c.title} · ${formatDateTime(c.updatedAt)}`}
                  >
                    {c.running ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    ) : c.pinned ? (
                      <Pin className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="truncate">{c.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Aksi percakapan"
                        className="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(c)}>
                        <PencilLine /> Ganti judul
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => update.mutate({ id: c.id, pinned: !c.pinned })}>
                        {c.pinned ? <PinOff /> : <Pin />} {c.pinned ? "Lepas sematan" : "Sematkan"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                        <Trash2 /> Hapus
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <RenameDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Ganti judul percakapan"
        label="Judul"
        initialValue={renaming?.title ?? ""}
        onSave={(title) => renaming && update.mutate({ id: renaming.id, title })}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus percakapan?"
        description="Percakapan dipindah ke Sampah dan bisa dipulihkan selama 30 hari. Jawaban yang masih berjalan dihentikan."
        itemName={deleting?.title}
        confirmLabel="Hapus"
        onConfirm={() => {
          if (deleting) {
            remove.mutate(deleting.id, { onError: (e) => toast.error(errorMessage(e)) });
            if (deleting.id === current) onNew();
          }
          setDeleting(null);
        }}
      />
    </>
  );
}

function ChatPane({
  conversationId,
  canSend,
  onCreated,
  historyButton,
}: {
  conversationId: string | null;
  canSend: boolean;
  onCreated: (id: string) => void;
  historyButton: React.ReactNode;
}) {
  const client = useQueryClient();
  const { data, isLoading, error: loadError } = useAgentConversation(conversationId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Pesan yang baru dikirim, ditampilkan sampai riwayat server memuatnya
  const [optimistic, setOptimistic] = useState<{ message: AgentChatMessage; before: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];
  const running = [...messages].reverse().find((m) => m.role === "agent" && m.status === "running");
  const refresh = () => {
    if (conversationId) void client.invalidateQueries({ queryKey: queryKeys.agentConversation(conversationId) });
    void client.invalidateQueries({ queryKey: queryKeys.agentConversations });
  };
  const { run, error: watchError } = useAgentRunWatcher(running?.runId ?? null, refresh);
  const busy = sending || !!running;
  const userCount = messages.filter((m) => m.role === "user").length;
  const shown = optimistic && userCount <= optimistic.before ? [...messages, optimistic.message] : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length, busy]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || !canSend) return;
    setSending(true);
    setSendError(null);
    setOptimistic({ message: { id: "pending", role: "user", text, at: new Date().toISOString() }, before: userCount });
    setDraft("");
    try {
      const started = await agentApi.chat(text, conversationId ?? undefined);
      void client.invalidateQueries({ queryKey: queryKeys.agentConversations });
      if (started.conversationId !== conversationId) onCreated(started.conversationId);
      else await client.invalidateQueries({ queryKey: queryKeys.agentConversation(started.conversationId) });
    } catch (e) {
      setDraft(text);
      setOptimistic(null);
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!running?.runId) return;
    try {
      await agentApi.stop(running.runId);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border bg-card">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        {historyButton}
        <BotMessageSquare className="size-4 shrink-0 text-module" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {conversationId ? (data?.title ?? "Memuat…") : "Percakapan baru"}
        </h3>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-muted/30 p-3">
        {loadError ? (
          <p className="m-auto text-sm text-muted-foreground">Percakapan tidak ditemukan (mungkin sudah dihapus).</p>
        ) : isLoading ? (
          <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat percakapan…
          </p>
        ) : shown.length === 0 ? (
          <p className="m-auto max-w-md text-center text-sm text-muted-foreground">
            Contoh: <em>“Pengajuan apa saja yang menunggu?”</em> atau{" "}
            <em>“Telaah pengajuan terbaru dengan skill telaah-pengajuan.”</em>
          </p>
        ) : (
          shown.map((m) =>
            m.role === "agent" && m.status === "running" ? null : <MessageBubble key={m.id} message={m} />,
          )
        )}
        {busy && (
          <div className="mr-auto flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {run?.status === "stopping" ? "Menghentikan…" : "Agen bekerja…"}
            {running?.runId && (
              <Button size="xs" variant="ghost" onClick={() => void stop()}>
                <Square /> Hentikan
              </Button>
            )}
          </div>
        )}
        {(watchError || sendError) && <p className="text-xs text-warning">{sendError ?? watchError}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(e) => void send(e)} className="flex shrink-0 items-end gap-2 border-t p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={!canSend}
          placeholder={
            canSend
              ? "Tulis pesan untuk agen… (Enter kirim, Shift+Enter baris baru)"
              : "Hermes tidak menyala — riwayat tetap bisa dibaca."
          }
          className="min-h-0"
        />
        <Button type="submit" disabled={busy || !canSend || !draft.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />} Kirim
        </Button>
      </form>
    </section>
  );
}

function MessageBubble({ message: m }: { message: AgentChatMessage }) {
  const copy = () => {
    void navigator.clipboard
      .writeText(m.text)
      .then(() => toast.success("Jawaban disalin."))
      .catch(() => toast.error("Gagal menyalin."));
  };
  if (m.role === "user")
    return (
      <div className="ml-auto max-w-[85%] rounded-xl bg-module px-3 py-2 text-sm whitespace-pre-line text-module-foreground">
        {m.text}
      </div>
    );
  return (
    <div
      className={cn(
        "group mr-auto max-w-[95%] rounded-xl border bg-card px-3 py-2 text-sm",
        m.status === "error" && "border-destructive/40 text-destructive",
      )}
    >
      {m.status === "error" ? <p className="whitespace-pre-line">{m.text}</p> : <Markdown content={m.text} />}
      {m.status !== "error" && (
        <div className="mt-1 flex justify-end">
          <Button
            size="xs"
            variant="ghost"
            onClick={copy}
            className="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
          >
            <Copy /> Salin
          </Button>
        </div>
      )}
    </div>
  );
}
