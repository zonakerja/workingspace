import {
  ArrowUp,
  Brain,
  Check,
  Copy,
  FileText,
  FolderKanban,
  ImageIcon,
  Loader2,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AkaiMark } from "@/components/akai-mark";
import { useShell } from "@/components/app-shell";
import { ArtifactCard, ArtifactPanel } from "@/components/chat/artifact-panel";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorText, type Model } from "@/lib/api";
import {
  type ChatMessage,
  type ToolRun,
  type Conversation,
  type UploadedAttachment,
  chatApi,
  formatSize,
  streamMessage,
} from "@/lib/chat";
import { type ArtifactVersion, collectVersions, parseArtifacts } from "@/lib/artifacts";
import { cn } from "@/lib/utils";

const AUTO = "auto";
const nowIso = () => new Date().toISOString();
const SUGGESTIONS = [
  "Buatkan kerangka laporan kegiatan bulanan",
  "Ringkas dokumen yang saya lampirkan",
  "Jelaskan perbedaan PSP dan penghapusan BMN",
  "Bantu saya menyusun email resmi",
];

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const time = hour < 11 ? "pagi" : hour < 15 ? "siang" : hour < 19 ? "sore" : "malam";
  return `Selamat ${time}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

/**
 * Chat Akai (6b.1): percakapan baru di `/chat`, lanjutan di `/chat/:id`. Jawaban stream dari gateway (tugas Chat + cadangan,
 * atau model pilihan) dan tersimpan di server; daftar di sidebar dimuat ulang setelah setiap jawaban.
 */
export function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, reloadConversations } = useShell();
  const location = useLocation();
  // Pertanyaan pertama dari halaman Proyek (percakapan baru di proyek) dikirim otomatis sekali
  const initialRef = useRef<string | null>((location.state as { initial?: string } | null)?.initial ?? null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelChoice, setModelChoice] = useState<string>(AUTO);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<(UploadedAttachment | { pending: string })[]>([]);
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamTools, setStreamTools] = useState<ToolRun[]>([]);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = streamText !== null;
  // Artifact yang dibuka di panel samping (identifier + nomor versi)
  const [openArtifact, setOpenArtifact] = useState<{ identifier: string; version: number } | null>(null);
  // Jumlah versi per identifier sebelum stream dimulai (untuk membuka versi baru yang sedang ditulis)
  const baseVersionsRef = useRef<Map<string, number>>(new Map());
  // Percakapan di URL belum dimuat (bukan yang sedang tampil)
  const loading = !!id && conversation?.id !== id;

  useEffect(() => {
    api
      .models()
      .then((list) => setModels(list.filter((m) => m.enabled && !m.embedding)))
      .catch(() => setModels([]));
  }, []);

  // Pindah percakapan: keadaan disetel ulang saat render (pola React "menyesuaikan state saat props berubah")
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setStreamError(null);
    setOpenArtifact(null);
    if (!id) {
      setConversation(null);
      setModelChoice(AUTO);
    }
  }

  // Gulir ke bawah selama pengguna belum menggulir ke atas
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [conversation?.messages.length, streamText, pendingUser]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ready = files.every((f) => !("pending" in f));
  const uploaded = files.filter((f): f is UploadedAttachment => !("pending" in f));

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).slice(0, 5 - files.length);
    if (incoming.length === 0) return toast.error("Maksimal 5 lampiran per pesan.");
    for (const file of incoming) {
      const key = `${file.name}-${Math.random()}`;
      setFiles((prev) => [...prev, { pending: key }]);
      try {
        const saved = await chatApi.upload(file);
        setFiles((prev) => prev.map((f) => ("pending" in f && f.pending === key ? saved : f)));
      } catch (error) {
        setFiles((prev) => prev.filter((f) => !("pending" in f && f.pending === key)));
        toast.error(`${file.name}: ${errorText(error)}`);
      }
    }
  }

  async function run(
    conversationId: string,
    body: { content?: string; attachmentIds?: string[]; regenerate?: boolean },
  ) {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamText("");
    setStreamTools([]);
    setStreamError(null);
    stickRef.current = true;
    baseVersionsRef.current = new Map(
      [...collectVersions(conversation?.messages ?? []).entries()].map(([key, list]) => [key, list.length]),
    );
    const result = await streamMessage(
      conversationId,
      body,
      (text, tools) => {
        setStreamText(text);
        setStreamTools(tools);
        // Model mulai menulis artifact → buka di panel (versi baru yang sedang ditulis)
        const arts = parseArtifacts(text).flatMap((seg) => (seg.kind === "artifact" ? [seg.artifact] : []));
        const last = arts[arts.length - 1];
        if (last) {
          const inStream = arts.filter((a) => a.identifier === last.identifier).length;
          const version = (baseVersionsRef.current.get(last.identifier) ?? 0) + inStream;
          setOpenArtifact((current) =>
            current?.identifier === last.identifier && current.version === version
              ? current
              : { identifier: last.identifier, version },
          );
        }
      },
      controller.signal,
    );
    if (!result.ok && !result.aborted) setStreamError(result.error ?? "Akai gagal menjawab.");
    // Server menyimpan jawaban setelah stream selesai (juga bila dihentikan) → muat ulang dari server
    try {
      const fresh = await chatApi.get(conversationId);
      setConversation(fresh);
    } catch {
      // dibiarkan: isi stream tetap terlihat sampai dimuat ulang
    }
    setPendingUser(null);
    setStreamText(null);
    abortRef.current = null;
    void reloadConversations();
    // Memori dicatat di latar belakang → muat ulang sekali agar penanda "Memori diperbarui" tampil
    if (result.ok && !body.regenerate)
      setTimeout(() => {
        chatApi
          .get(conversationId)
          .then((fresh) =>
            setConversation((current) => (current?.id === conversationId && !abortRef.current ? fresh : current)),
          )
          .catch(() => undefined);
      }, 6000);
  }

  async function send(text = input, targetId = id) {
    const content = text.trim();
    if (busy || !ready || (!content && uploaded.length === 0)) return;
    const attachments = uploaded.map(({ id: fileId, name, mimeType, size }) => ({ id: fileId, name, mimeType, size }));
    let conversationId = targetId;
    try {
      if (!conversationId) {
        const created = await chatApi.create(modelChoice === AUTO ? null : modelChoice);
        conversationId = created.id;
        skipLoadRef.current = created.id;
        setConversation({ ...created, messages: [] });
        navigate(`/chat/${created.id}`);
      }
    } catch (error) {
      return toast.error(errorText(error));
    }
    setInput("");
    setFiles([]);
    setPendingUser({
      id: "pending",
      role: "user",
      content,
      attachments: attachments.length ? attachments : null,
      model: null,
      fallbackFrom: null,
      error: null,
      createdAt: nowIso(),
    });
    await run(conversationId!, { content, attachmentIds: attachments.map((a) => a.id) });
    textareaRef.current?.focus();
  }

  // Kirim pertanyaan pertama dari halaman Proyek (dipanggil dari effect pemuat, selalu memakai send terbaru)
  const sendInitial = useEffectEvent((text: string, conversationId: string) => {
    void send(text, conversationId);
  });

  // Muat percakapan saat id berubah (kecuali percakapan yang baru dibuat oleh halaman ini sendiri)
  useEffect(() => {
    if (!id) return;
    if (skipLoadRef.current === id) {
      skipLoadRef.current = null;
      return;
    }
    let alive = true;
    chatApi
      .get(id)
      .then((c) => {
        if (!alive) return;
        setConversation(c);
        setModelChoice(c.modelId ?? AUTO);
        stickRef.current = true;
        const initial = initialRef.current;
        if (initial && c.messages.length === 0) {
          initialRef.current = null;
          navigate(`/chat/${c.id}`, { replace: true, state: null });
          sendInitial(initial, c.id);
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        toast.error(errorText(error));
        navigate("/chat", { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  async function changeModel(value: string) {
    setModelChoice(value);
    if (!conversation) return;
    try {
      await chatApi.update(conversation.id, { modelId: value === AUTO ? null : value });
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) {
      e.preventDefault();
      void addFiles(pasted);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  const messages = useMemo(() => {
    const list = conversation?.messages ?? [];
    return pendingUser ? [...list, pendingUser] : list;
  }, [conversation, pendingUser]);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const versions = useMemo(
    () =>
      collectVersions(
        streamText ? [...messages, { id: "streaming", role: "assistant", content: streamText }] : messages,
      ),
    [messages, streamText],
  );
  const panelVersions = openArtifact ? (versions.get(openArtifact.identifier) ?? []) : [];
  const openPanel = (identifier: string, version: number) => setOpenArtifact({ identifier, version });
  const empty = messages.length === 0 && !loading;

  const composer = (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm transition focus-within:ring-2 focus-within:ring-ring/30",
        dragging && "ring-2 ring-primary",
      )}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((f, index) =>
            "pending" in f ? (
              <span
                key={f.pending}
                className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" /> Mengunggah…
              </span>
            ) : (
              <span
                key={f.id}
                className="flex max-w-56 items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs"
              >
                {f.kind === "image" ? (
                  <ImageIcon className="size-3.5 shrink-0" />
                ) : (
                  <FileText className="size-3.5 shrink-0" />
                )}
                <span className="truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Lepas ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ),
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={1}
        placeholder="Tanya Akai apa saja…"
        className="field-sizing-content max-h-60 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || files.length >= 5}
          aria-label="Lampirkan berkas"
          title="Lampirkan gambar, PDF, atau berkas teks"
        >
          <Paperclip />
        </Button>
        <Select value={modelChoice} onValueChange={(value) => void changeModel(value)} disabled={busy}>
          <SelectTrigger
            size="sm"
            className="h-8 max-w-56 border-none bg-transparent text-xs shadow-none hover:bg-accent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={AUTO}>Otomatis (tugas Chat)</SelectItem>
            </SelectGroup>
            {models.length > 0 && (
              <SelectGroup>
                <SelectLabel>Model tertentu</SelectLabel>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          {busy ? (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
              aria-label="Hentikan"
              title="Hentikan"
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={() => void send()}
              disabled={!ready || (!input.trim() && uploaded.length === 0)}
              aria-label="Kirim"
              title="Kirim (Enter)"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <AkaiMark className="size-12" />
              <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
                {greeting(me.account.name)}
              </h1>
              <p className="text-sm text-muted-foreground">Ada yang bisa Akai bantu hari ini?</p>
            </div>
            <div className="w-full max-w-3xl">{composer}</div>
            <div className="flex max-w-3xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Sparkles className="mr-1 inline size-3" />
                  {s}
                </button>
              ))}
            </div>
            {models.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Belum ada model menyala.{" "}
                <Link to="/models" className="underline">
                  Atur sumber & model
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
                {conversation?.project && (
                  <Link
                    to={`/projects/${conversation.project.id}`}
                    className="flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <FolderKanban className="size-3.5" /> {conversation.project.name}
                  </Link>
                )}
                {loading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
                {messages.map((m) => (
                  <MessageView
                    key={m.id}
                    message={m}
                    versions={versions}
                    openArtifact={openArtifact}
                    onOpenArtifact={openPanel}
                    isLast={!busy && m.id === lastAssistant?.id}
                    onRegenerate={() => conversation && void run(conversation.id, { regenerate: true })}
                  />
                ))}
                {busy && (
                  <div className="flex gap-3">
                    <AkaiMark className="mt-0.5 size-7" />
                    <div className="min-w-0 flex-1">
                      <ToolRuns runs={streamTools} />
                      {streamText ? (
                        <AnswerBody
                          messageId="streaming"
                          text={streamText}
                          versions={versions}
                          openArtifact={openArtifact}
                          onOpenArtifact={openPanel}
                        />
                      ) : streamTools.length ? null : (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" /> Akai sedang berpikir…
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {streamError && (
                  <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{streamError}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 px-4 pt-2 pb-4">
              <div className="mx-auto w-full max-w-3xl">
                {composer}
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  Akai bisa keliru. Periksa kembali informasi penting.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      {openArtifact && panelVersions.length > 0 && (
        <div className="fixed inset-0 z-40 bg-background lg:static lg:inset-auto lg:z-auto lg:w-[48%] lg:max-w-3xl lg:shrink-0 lg:border-l">
          <ArtifactPanel
            key={openArtifact.identifier}
            versions={panelVersions}
            version={openArtifact.version}
            onVersion={(version) => setOpenArtifact({ identifier: openArtifact.identifier, version })}
            onClose={() => setOpenArtifact(null)}
          />
        </div>
      )}
    </div>
  );
}

/** Jejak alat konektor: chip per pemanggilan (berjalan / selesai / gagal), dibuka = masukan & hasil ringkas. */
function ToolRuns({ runs }: { runs: ToolRun[] }) {
  if (!runs.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {runs.map((run) => (
        <details key={run.id} className="group w-fit max-w-full rounded-lg border bg-muted/40 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5">
            {run.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : run.status === "error" ? (
              <TriangleAlert className="size-3.5 text-destructive" />
            ) : run.connector === "Skill" ? (
              <Sparkles className="size-3.5 text-primary" />
            ) : (
              <Wrench className="size-3.5 text-primary" />
            )}
            <span className="font-medium">{run.connector}</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate font-mono">{run.connector === "Skill" ? run.tool : (run.title ?? run.tool)}</span>
            <span className="text-muted-foreground">
              {run.status === "running" ? "berjalan…" : run.status === "error" ? "gagal" : "selesai"}
            </span>
          </summary>
          <div className="flex flex-col gap-1.5 border-t px-2.5 py-2">
            <p className="font-medium text-muted-foreground">Masukan</p>
            <pre className="max-h-32 overflow-auto rounded bg-background p-1.5 font-mono whitespace-pre-wrap">
              {run.input}
            </pre>
            {run.output && (
              <>
                <p className="font-medium text-muted-foreground">Hasil</p>
                <pre className="max-h-48 overflow-auto rounded bg-background p-1.5 font-mono whitespace-pre-wrap">
                  {run.output}
                </pre>
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

type ArtifactProps = {
  versions: Map<string, ArtifactVersion[]>;
  openArtifact: { identifier: string; version: number } | null;
  onOpenArtifact: (identifier: string, version: number) => void;
};

/** Isi jawaban: teks Markdown + kartu artifact (nomor versi dari urutan dalam percakapan). */
function AnswerBody({
  messageId,
  text,
  versions,
  openArtifact,
  onOpenArtifact,
}: ArtifactProps & { messageId: string; text: string }) {
  const seen = new Map<string, number>();
  return (
    <>
      {parseArtifacts(text).map((seg, index) => {
        if (seg.kind === "text") return <Markdown key={index} text={seg.text} />;
        const nth = seen.get(seg.artifact.identifier) ?? 0;
        seen.set(seg.artifact.identifier, nth + 1);
        const own = (versions.get(seg.artifact.identifier) ?? []).filter((v) => v.messageId === messageId);
        const version = own[nth]?.version ?? 1;
        return (
          <ArtifactCard
            key={index}
            artifact={seg.artifact}
            version={version}
            active={openArtifact?.identifier === seg.artifact.identifier && openArtifact.version === version}
            onOpen={() => onOpenArtifact(seg.artifact.identifier, version)}
          />
        );
      })}
    </>
  );
}

function MessageView({
  message,
  isLast,
  onRegenerate,
  versions,
  openArtifact,
  onOpenArtifact,
}: {
  message: ChatMessage;
  isLast: boolean;
  onRegenerate: () => void;
} & ArtifactProps) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user")
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a) =>
              a.mimeType.startsWith("image/") && message.id !== "pending" ? (
                <a key={a.id} href={chatApi.attachmentUrl(a.id)} target="_blank" rel="noreferrer">
                  <img
                    src={chatApi.attachmentUrl(a.id)}
                    alt={a.name}
                    className="max-h-40 max-w-56 rounded-xl border object-cover"
                  />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={message.id === "pending" ? undefined : chatApi.attachmentUrl(a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs hover:bg-accent"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{a.name}</span>
                </a>
              ),
            )}
          </div>
        )}
        {message.content && (
          <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] whitespace-pre-wrap">
            {message.content}
          </div>
        )}
      </div>
    );

  return (
    <div className="group flex gap-3">
      <AkaiMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        {message.toolRuns && <ToolRuns runs={message.toolRuns} />}
        {message.content ? (
          <AnswerBody
            messageId={message.id}
            text={message.content}
            versions={versions}
            openArtifact={openArtifact}
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}
        {message.error && (
          <div className="mt-1 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100">
          {message.content && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Salin jawaban"
              title="Salin"
              onClick={() => {
                void navigator.clipboard.writeText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          )}
          {isLast && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Ulangi jawaban"
              title="Ulangi jawaban"
              onClick={onRegenerate}
            >
              <RefreshCw />
            </Button>
          )}
          {message.model && (
            <span className="ml-1 text-[11px]">
              {message.model}
              {message.fallbackFrom ? ` · cadangan (${message.fallbackFrom} gagal)` : ""}
            </span>
          )}
        </div>
        {message.memoryUpdates && message.memoryUpdates.length > 0 && (
          <details className="mt-1 w-fit text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
              <Brain className="size-3.5" /> Memori diperbarui
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 border-l pl-3">
              {message.memoryUpdates.map((u, i) => (
                <li key={i} className={u.op === "remove" ? "line-through" : undefined}>
                  {u.op === "add" ? "+ " : "− "}
                  {u.content}
                </li>
              ))}
              <li>
                <Link to="/memory" className="underline underline-offset-2">
                  Kelola memori
                </Link>
              </li>
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
