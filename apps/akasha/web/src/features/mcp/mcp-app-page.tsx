import { ArrowLeft, Bot, KeyRound, Play, Plug, RefreshCw, Settings2, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SectionCard } from "@/components/common/section-card";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMcpConnectionMutations, useMcpConnections } from "@/data/use-mcp-connections";
import { useSetSearchParams } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { McpConnectionInfo, McpToolSummary } from "@/types/api";
import {
  agentAllowed,
  AUTH_LABEL,
  parseArgs,
  STATUS_LABEL,
  STATUS_TONE,
  TOOL_KIND_LABEL,
  TOOL_KIND_TONE,
  toggleAgentTool,
  toolKind,
} from "./mcp-utils";
import { OAuthClientFields, type OAuthClientValue } from "./oauth-client-fields";
import { useConnectApp } from "./use-connect-app";

/** Alamat lama `/mcp-app/:slug` (tautan tersimpan, kembalian OAuth lama) → `/mcp/apps/:slug`. */
export function Component() {
  const { slug } = useParams();
  return <Navigate to={`/mcp/apps/${slug ?? ""}${window.location.search}`} replace />;
}

/**
 * Aplikasi MCP → satu aplikasi (`/mcp/apps/:slug`, dipasang di `mcp-page.tsx`): status, sambungkan, pengaturan OAuth,
 * izin agen, daftar alat. Dulu halaman sendiri dengan menu di sidebar (keputusan user 2026-11-13: cukup di dalam menu Aplikasi MCP).
 */
export function McpAppView({ slug }: { slug: string }) {
  const { data, isLoading } = useMcpConnections();
  const connection = data?.find((c) => c.slug === slug);
  const setParams = useSetSearchParams();
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const error = params.get("error");

  // Kembali dari halaman izin aplikasi (jendela yang dibuka saat Sambungkan)
  useEffect(() => {
    if (connected) toast.success("Aplikasi tersambung. Jendela ini boleh ditutup.");
    if (error) toast.error(error);
    if (connected || error) setParams({ connected: null, error: null });
  }, [connected, error, setParams]);

  return (
    <div className="grid grid-cols-1 gap-3">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/mcp/apps">
            <ArrowLeft /> Semua aplikasi
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <Spinner className="m-6" />
      ) : connection ? (
        <AppDetail connection={connection} />
      ) : (
        <Empty className="rounded-2xl border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plug />
            </EmptyMedia>
            <EmptyTitle>Aplikasi tidak ditemukan</EmptyTitle>
            <EmptyDescription>Koneksi ini sudah dihapus atau belum dibuat.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/mcp/apps">Buka Aplikasi MCP</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}

function AppDetail({ connection }: { connection: McpConnectionInfo }) {
  const m = useMcpConnectionMutations();
  const connect = useConnectApp();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [oauthOpen, setOauthOpen] = useState(false);
  const [trying, setTrying] = useState<McpToolSummary | null>(null);
  const waiting = connect.waitingFor === connection.id;

  const patch = (input: { agentEnabled?: boolean; allowWrite?: boolean; agentTools?: string[] }) =>
    m.update.mutate({ id: connection.id, input }, { onError: (e) => toast.error(errorMessage(e)) });
  const refresh = () =>
    m.refresh.mutate(connection.id, {
      onSuccess: (c) =>
        c.status === "connected"
          ? toast.success(`${c.tools.length} alat dimuat.`)
          : toast.error(c.statusMessage ?? STATUS_LABEL[c.status]),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <div className="grid grid-cols-1 gap-4">
      <SectionCard
        icon={Plug}
        title="Koneksi"
        description={AUTH_LABEL[connection.authType]}
        action={<Badge className={STATUS_TONE[connection.status]}>{STATUS_LABEL[connection.status]}</Badge>}
        contentClassName="grid grid-cols-1 gap-3"
      >
        {connection.statusMessage && (
          <p className="text-sm break-words text-muted-foreground">{connection.statusMessage}</p>
        )}
        {connection.authType === "oauth" && connection.oauthClientId && (
          <p className="text-xs break-all text-muted-foreground">OAuth client: {connection.oauthClientId}</p>
        )}
        {connection.lastCheckedAt && (
          <p className="text-xs text-muted-foreground">Terakhir dicek {formatDateTime(connection.lastCheckedAt)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={connect.pending || waiting} onClick={() => connect.start(connection)}>
            {waiting ? <Spinner /> : <Plug />}
            {connection.status === "connected" ? "Sambungkan ulang" : "Sambungkan"}
          </Button>
          <Button variant="outline" disabled={m.refresh.isPending} onClick={refresh}>
            <RefreshCw className={cn(m.refresh.isPending && "animate-spin")} /> Muat ulang alat
          </Button>
          {connection.authType === "token" && (
            <Button variant="outline" onClick={() => setTokenOpen(true)}>
              <KeyRound /> {connection.hasToken ? "Ganti token" : "Isi token"}
            </Button>
          )}
          {connection.authType === "oauth" && (
            <Button variant="outline" onClick={() => setOauthOpen(true)}>
              <Settings2 /> Pengaturan OAuth
            </Button>
          )}
          <Button variant="ghost" className="text-destructive" onClick={() => setRemoving(true)}>
            <Trash2 /> Hapus koneksi
          </Button>
        </div>
        {waiting && (
          <p className="text-xs text-muted-foreground">
            Menunggu izin di jendela aplikasi… Halaman ini diperbarui otomatis setelah Anda menyetujui.
          </p>
        )}
      </SectionCard>

      <SectionCard
        icon={Bot}
        title="Izin agen"
        description="Agen (Hermes) memakai alat aplikasi ini lewat Akasha; token tidak pernah diberikan ke agen."
        contentClassName="grid grid-cols-1 gap-3"
      >
        <label className="flex items-start justify-between gap-3">
          <span className="text-sm">
            <span className="font-medium">Izinkan agen memakai aplikasi ini</span>
            <span className="block text-xs text-muted-foreground">Alat bertanda Baca bisa dipakai agen.</span>
          </span>
          <Switch checked={connection.agentEnabled} onCheckedChange={(v) => patch({ agentEnabled: v })} />
        </label>
        <label className="flex items-start justify-between gap-3">
          <span className="text-sm">
            <span className="font-medium">Izinkan aksi yang mengubah data</span>
            <span className="block text-xs text-muted-foreground">
              Alat bertanda Ubah (mis. membuat desain). Alat bertanda Hapus hanya bila Anda izinkan satu per satu di
              daftar alat di bawah.
            </span>
          </span>
          <Switch
            checked={connection.allowWrite}
            disabled={!connection.agentEnabled}
            onCheckedChange={(v) => patch({ allowWrite: v })}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Agen butuh izin <b>Pakai alat aplikasi MCP</b>: tekan <b>Siapkan agen</b> di{" "}
          <Link to="/agent/status" className="underline">
            AI Agent → Status & Skill
          </Link>{" "}
          dan centang izin itu, lalu agen dimulai ulang.
        </p>
      </SectionCard>

      <SectionCard
        icon={Wrench}
        title={`Alat (${connection.tools.length})`}
        description="Daftar dari server aplikasi. Tanda Baca/Ubah/Hapus berasal dari penyedia; alat tanpa tanda dianggap Ubah."
        contentClassName="grid grid-cols-1 gap-2"
      >
        {!connection.tools.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada daftar alat. Sambungkan dulu, lalu Muat ulang alat.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {connection.tools.map((tool) => {
              const kind = toolKind(tool);
              return (
                <li key={tool.name} className="min-w-0 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-semibold break-all">{tool.title ?? tool.name}</code>
                    <Badge className={TOOL_KIND_TONE[kind]}>{TOOL_KIND_LABEL[kind]}</Badge>
                    {connection.agentEnabled && (
                      <Badge variant="outline">
                        {agentAllowed(connection, tool) ? "Agen boleh" : "Agen tidak boleh"}
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setTrying(tool)}>
                      <Play /> Coba
                    </Button>
                  </div>
                  {tool.description && (
                    <p className="mt-1 text-xs break-words text-muted-foreground">{tool.description}</p>
                  )}
                  {kind === "delete" && connection.agentEnabled && (
                    <label className="mt-2 flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-2">
                      <span className="text-xs">
                        <span className="font-medium">Izinkan agen menjalankan alat ini</span>
                        <span className="block text-muted-foreground">
                          Penyedia menandainya bisa menghapus/menimpa data. Izinkan hanya bila alat ini memang perlu
                          untuk kerja agen (mis. menyimpan hasil sunting desain); butuh izin aksi tulis.
                        </span>
                      </span>
                      <Switch
                        checked={connection.agentTools.includes(tool.name)}
                        disabled={!connection.allowWrite || m.update.isPending}
                        onCheckedChange={(on) =>
                          patch({ agentTools: toggleAgentTool(connection.agentTools, tool.name, on) })
                        }
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Dialog open={oauthOpen} onOpenChange={setOauthOpen}>
        <DialogContent className="max-h-[92svh] grid-cols-1 overflow-y-auto sm:max-w-lg">
          {oauthOpen && <OAuthSettingsForm connection={connection} onDone={() => setOauthOpen(false)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Hapus koneksi?"
        description="Token dan izin aplikasi yang tersimpan dihapus, dan agen tidak bisa lagi memakainya. Data di aplikasi itu sendiri tidak tersentuh."
        itemName={connection.name}
        confirmLabel="Hapus koneksi"
        onConfirm={() =>
          m.remove.mutate(connection.id, {
            onSuccess: () => {
              toast.success("Koneksi dihapus.");
              void navigate("/mcp/apps");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <TokenDialog connection={connection} open={tokenOpen} onOpenChange={setTokenOpen} />
      <TryToolDialog connection={connection} tool={trying} onClose={() => setTrying(null)} />
    </div>
  );
}

function TokenDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: McpConnectionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const m = useMcpConnectionMutations();
  const [token, setToken] = useState("");
  const save = () =>
    m.update.mutate(
      { id: connection.id, input: { token } },
      {
        onSuccess: () => {
          toast.success("Token disimpan. Tekan Sambungkan untuk menguji.");
          setToken("");
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Token akses {connection.name}</DialogTitle>
          <DialogDescription>Token lama diganti. Disimpan terenkripsi dan tidak ditampilkan lagi.</DialogDescription>
        </DialogHeader>
        <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <DialogFooter>
          <Button onClick={save} disabled={!token.trim() || m.update.isPending}>
            Simpan token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Jalankan satu alat sebagai pemilik (argumen JSON) — untuk memeriksa koneksi & melihat hasilnya. */
function TryToolDialog({
  connection,
  tool,
  onClose,
}: {
  connection: McpConnectionInfo;
  tool: McpToolSummary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!tool} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-cols-1 sm:max-w-lg">
        {tool && <TryToolForm key={tool.name} connection={connection} tool={tool} />}
      </DialogContent>
    </Dialog>
  );
}

function TryToolForm({ connection, tool }: { connection: McpConnectionInfo; tool: McpToolSummary }) {
  const m = useMcpConnectionMutations();
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<{ isError: boolean; text: string } | null>(null);
  const kind = toolKind(tool);
  const run = () => {
    const parsed = parseArgs(args);
    if (!parsed.ok) return toast.error(parsed.error);
    m.call.mutate(
      { id: connection.id, tool: tool.name, args: parsed.value },
      { onSuccess: setResult, onError: (e) => toast.error(errorMessage(e)) },
    );
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-all">{tool.title ?? tool.name}</DialogTitle>
        <DialogDescription>
          {kind === "read"
            ? "Alat ini hanya membaca."
            : "Alat ini bisa mengubah data di aplikasi. Dijalankan atas nama Anda."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-sm font-medium" htmlFor="mcp-args">
          Argumen (JSON)
        </label>
        <Textarea
          id="mcp-args"
          className="min-h-24 font-mono text-xs"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
        />
        {result && (
          <pre
            className={cn(
              "max-h-64 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap",
              result.isError && "text-destructive",
            )}
          >
            {result.text || "(tanpa isi)"}
          </pre>
        )}
      </div>
      <DialogFooter>
        <Button onClick={run} disabled={m.call.isPending}>
          {m.call.isPending ? <Spinner /> : <Play />} Jalankan
        </Button>
      </DialogFooter>
    </>
  );
}

/** Ubah OAuth client / scope. Berubah = izin lama dibuang dan aplikasi perlu disambungkan ulang. */
function OAuthSettingsForm({ connection, onDone }: { connection: McpConnectionInfo; onDone: () => void }) {
  const m = useMcpConnectionMutations();
  const [value, setValue] = useState<OAuthClientValue>({
    clientId: connection.oauthClientId ?? "",
    clientSecret: "",
    scope: connection.oauthScope ?? "",
  });
  const save = () =>
    m.update.mutate(
      {
        id: connection.id,
        input: {
          oauthClientId: value.clientId,
          oauthScope: value.scope,
          ...(value.clientSecret.trim() ? { oauthClientSecret: value.clientSecret } : {}),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(c.status === "auth_required" ? "Tersimpan. Tekan Sambungkan untuk masuk ulang." : "Tersimpan.");
          onDone();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Pengaturan OAuth {connection.name}</DialogTitle>
        <DialogDescription>
          Untuk aplikasi yang tidak mendukung pendaftaran otomatis (Google, GitHub OAuth App) isi Client ID & Secret
          dari OAuth client milik Anda. Mengubahnya membuang izin lama; sambungkan ulang setelah menyimpan.
        </DialogDescription>
      </DialogHeader>
      <OAuthClientFields
        value={value}
        onChange={setValue}
        redirectUrl={connection.redirectUrl}
        hasSecret={connection.hasClientSecret}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button onClick={save} disabled={m.update.isPending}>
          {m.update.isPending && <Spinner />} Simpan
        </Button>
      </DialogFooter>
    </>
  );
}
