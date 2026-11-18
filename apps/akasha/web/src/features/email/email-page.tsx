import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ExternalLink,
  Inbox,
  ListTodo,
  Mail,
  Paperclip,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { HeroStat, ModulePage } from "@/components/layout/module-page";
import { SearchInput } from "@/components/common/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMailAccounts } from "@/data/use-connected-accounts";
import { useInboxMutations, useMailMessage, useMailMessageMutations, useMailMessages } from "@/data/use-mail-inbox";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useOpenSession } from "@/hooks/use-retained";
import { useSearchParam } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { links } from "@/lib/deep-links";
import { cn } from "@/lib/utils";
import type { MailMessageDetail, MailMessageSummary, MailStatus } from "@/types/api";
import { formatBytes, hintLabel, listTime, senderName, TAB_STATUS } from "./email-utils";
import { SendEmailRequestsCard } from "./send-email-requests-card";

/**
 * Menu Email (docs/AKUN-TERSAMBUNG.md tahap 1): kotak masuk gabungan semua akun email yang kotak masuknya dinyalakan di
 * Pengaturan → Akun Tersambung. Akasha hanya membaca salinan email; email asli tetap di Gmail / server email.
 */
export function Component() {
  const { data: accounts } = useMailAccounts();
  const inboxAccounts = useMemo(() => (accounts ?? []).filter((a) => a.inboxEnabled), [accounts]);
  const { sync } = useInboxMutations();
  const [syncing, setSyncing] = useState(false);

  const syncAll = async () => {
    setSyncing(true);
    let added = 0;
    for (const account of inboxAccounts) {
      try {
        added += (await sync.mutateAsync(account.id)).added;
      } catch (error) {
        toast.error(`${account.address}: ${errorMessage(error)}`);
      }
    }
    setSyncing(false);
    toast.success(added ? `${added} email baru.` : "Tidak ada email baru.");
  };

  return (
    <ModulePage
      module="email"
      meta={<HeroStat>{inboxAccounts.length} akun</HeroStat>}
      actions={
        inboxAccounts.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void syncAll()} disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} /> Sinkron
          </Button>
        )
      }
    >
      {(tab) =>
        accounts && inboxAccounts.length === 0 ? (
          <Empty className="rounded-2xl border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>Kotak masuk belum dinyalakan</EmptyTitle>
              <EmptyDescription>
                Tambahkan akun email (Gmail dengan Sandi Aplikasi atau email lain) lalu nyalakan <b>Kotak masuk</b> di
                Pengaturan → Akun Tersambung.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild size="sm">
              <Link to="/settings/accounts">
                <Settings /> Buka Akun Tersambung
              </Link>
            </Button>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <SendEmailRequestsCard />
            <Mailbox
              status={TAB_STATUS[(tab ?? "inbox") as keyof typeof TAB_STATUS] ?? "new"}
              accounts={inboxAccounts}
            />
          </div>
        )
      }
    </ModulePage>
  );
}

function Mailbox({
  status,
  accounts,
}: {
  status: MailStatus;
  accounts: { id: string; label: string; address: string }[];
}) {
  const [accountId, setAccountId] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useSearchParam("message");
  const wide = useMediaQuery("(min-width: 1024px)");
  const filter = { status, accountId: accountId === "all" ? undefined : accountId, q: q.trim() || undefined };
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMailMessages(filter);
  const messages = data?.pages.flatMap((p) => p.messages) ?? [];
  const now = useNow();

  const list = (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Cari pengirim / subjek…" className="min-w-0 flex-1" />
        {accounts.length > 1 && (
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-44" aria-label="Akun">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua akun</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label} · {a.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto rounded-2xl border lg:h-[calc(100svh-16rem)]">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {q ? "Tidak ada email yang cocok." : "Belum ada email di sini."}
          </p>
        ) : (
          <ul className="divide-y">
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                active={m.id === selected}
                now={now}
                onOpen={() => setSelected(m.id)}
              />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <div className="p-2 text-center">
            <Button variant="ghost" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              Muat email lama
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  if (wide) {
    return (
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        {list}
        <div className="min-w-0 rounded-2xl border lg:h-[calc(100svh-13.5rem)] lg:overflow-y-auto">
          {selected ? (
            <MessageDetail id={selected} />
          ) : (
            <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-8 opacity-40" /> Pilih email untuk membaca.
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      {list}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="grid-cols-1 max-h-[92svh] overflow-y-auto p-0 sm:max-w-2xl">
          <DialogTitle className="sr-only">Email</DialogTitle>
          {selected && <MessageDetail id={selected} onBack={() => setSelected(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageRow({
  message: m,
  active,
  now,
  onOpen,
}: {
  message: MailMessageSummary;
  active: boolean;
  now: Date;
  onOpen: () => void;
}) {
  const hint = hintLabel(m.hints);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full min-w-0 flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
          active && "bg-module-soft",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{senderName(m)}</span>
          {m.attachments.length > 0 && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="shrink-0 text-xs text-muted-foreground">{listTime(m.sentAt, now)}</span>
        </span>
        <span className="truncate text-sm">{m.subject || "(tanpa subjek)"}</span>
        <span className="truncate text-xs text-muted-foreground">{m.snippet}</span>
        {(hint || m.linked.length > 0) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {hint && (
              <Badge variant="secondary" className={cn(m.hints.kind === "bill" ? "text-warning" : "text-info")}>
                {hint}
              </Badge>
            )}
            {m.linked.map((l) => (
              <Badge key={l.type} variant="outline">
                {l.type === "todo" ? "To-do" : "Agenda"}
              </Badge>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

function MessageDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const { data: m, isLoading } = useMailMessage(id);
  const mutations = useMailMessageMutations();
  const [dialog, setDialog] = useState<"todo" | "agenda" | null>(null);
  const session = useOpenSession(dialog !== null);
  const fail = (error: unknown) => toast.error(errorMessage(error));

  if (isLoading || !m) return <Skeleton className="m-4 h-60" />;
  const hint = hintLabel(m.hints);
  const setStatus = (status: MailStatus) => mutations.status.mutate({ id: m.id, status }, { onError: fail });

  return (
    <article className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Kembali">
            <ArrowLeft />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold break-words">{m.subject || "(tanpa subjek)"}</h2>
          <p className="text-xs text-muted-foreground break-words">
            {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress} · {formatDateTime(m.sentAt)}
            {m.account && ` · ke ${m.account.address}`}
          </p>
        </div>
      </div>

      {hint && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm",
            m.hints.kind === "bill" ? "border-warning/40 bg-warning/5" : "border-info/40 bg-info/5",
          )}
        >
          {m.hints.kind === "bill" ? (
            <ReceiptText className="size-4 text-warning" />
          ) : (
            <CalendarPlus className="size-4 text-info" />
          )}
          <span className="font-medium">{hint}</span>
          <span className="text-xs text-muted-foreground">
            dikenali otomatis dari isi email — periksa sebelum disimpan
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDialog("todo")}>
          <ListTodo /> Jadikan to-do
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialog("agenda")}>
          <CalendarPlus /> Jadikan agenda
        </Button>
        {m.status === "new" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus("done")}>
              <Check /> Selesai
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus("ignored")}>
              <X /> Abaikan
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setStatus("new")}>
            <RotateCcw /> Kembalikan ke kotak masuk
          </Button>
        )}
      </div>

      {m.linked.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {m.linked.map((l) => (
            <Link
              key={l.type}
              to={l.type === "todo" ? links.todo(l.id) : links.schedule(l.id)}
              className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-muted"
            >
              <ExternalLink className="size-3" /> Buka {l.type === "todo" ? "to-do" : "agenda"}
            </Link>
          ))}
        </div>
      )}

      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs">
              <Paperclip className="size-3" /> {a.name} · {formatBytes(a.size)}
            </span>
          ))}
          <span className="w-full text-xs text-muted-foreground">Lampiran dibuka di aplikasi email Anda.</span>
        </div>
      )}

      <div className="rounded-xl border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
        {m.body || "(isi kosong)"}
      </div>

      <Dialog open={dialog === "todo"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="grid-cols-1 sm:max-w-md">
          <TodoForm key={session} message={m} onDone={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "agenda"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="grid-cols-1 sm:max-w-md">
          <AgendaForm key={session} message={m} onDone={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
    </article>
  );
}

function TodoForm({ message, onDone }: { message: MailMessageDetail; onDone: () => void }) {
  const { todo } = useMailMessageMutations();
  const [title, setTitle] = useState(message.suggestions.todo.title);
  const [date, setDate] = useState(message.suggestions.todo.date);
  const [priority, setPriority] = useState<string>(message.suggestions.todo.priority);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        todo.mutate(
          { id: message.id, input: { title, date, priority } },
          {
            onSuccess: () => {
              toast.success("To-do dibuat di Planner.");
              onDone();
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Jadikan to-do</DialogTitle>
        <DialogDescription>To-do muncul di Planner → Harian pada tanggal yang dipilih.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mail-todo-title">Judul</Label>
        <Input id="mail-todo-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="mail-todo-date">Tanggal</Label>
          <Input id="mail-todo-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Prioritas</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">Tinggi</SelectItem>
              <SelectItem value="medium">Sedang</SelectItem>
              <SelectItem value="low">Rendah</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={todo.isPending}>
          Simpan to-do
        </Button>
      </DialogFooter>
    </form>
  );
}

function AgendaForm({ message, onDone }: { message: MailMessageDetail; onDone: () => void }) {
  const { agenda } = useMailMessageMutations();
  const base = message.suggestions.agenda ?? {
    title: message.subject,
    startDate: message.suggestions.todo.date,
    startTime: "",
  };
  const [title, setTitle] = useState(base.title || "Agenda dari email");
  const [startDate, setStartDate] = useState(base.startDate);
  const [startTime, setStartTime] = useState(base.startTime);
  const [endTime, setEndTime] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        agenda.mutate(
          { id: message.id, input: { title, startDate, startTime, endTime: startTime ? endTime : "" } },
          {
            onSuccess: () => {
              toast.success("Agenda dibuat di Planner.");
              onDone();
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Jadikan agenda</DialogTitle>
        <DialogDescription>Agenda tampil di Planner dan ikut langganan kalender Anda.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mail-agenda-title">Judul</Label>
        <Input
          id="mail-agenda-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 flex flex-col gap-2 sm:col-span-1">
          <Label htmlFor="mail-agenda-date">Tanggal</Label>
          <Input
            id="mail-agenda-date"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mail-agenda-start">Mulai</Label>
          <Input id="mail-agenda-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mail-agenda-end">Selesai</Label>
          <Input
            id="mail-agenda-end"
            type="time"
            value={endTime}
            disabled={!startTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={agenda.isPending}>
          Simpan agenda
        </Button>
      </DialogFooter>
    </form>
  );
}
