import { useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Plug, X } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAgentActionMutations, useAgentActions } from "@/data/use-agent-actions";
import { queryKeys } from "@/data/query-keys";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import type { AgentActionInfo } from "@/types/api";
import { AUTH_LABEL } from "./mcp-utils";

interface ConnectSnapshot {
  name?: string;
  url?: string;
  authType?: keyof typeof AUTH_LABEL;
}

interface AccessSnapshot {
  slug?: string;
  name?: string;
  agentEnabled?: boolean;
  allowWrite?: boolean;
  allowTools?: string[];
}

const yesNo = (v: boolean | undefined, on: string, off: string) => (v === undefined ? null : v ? on : off);

/** Rincian satu permintaan untuk dibaca pemilik sebelum memutuskan. */
function requestFacts(action: AgentActionInfo) {
  if (action.kind === "mcp_connect") {
    const snap = (action.after ?? {}) as ConnectSnapshot;
    return [snap.url, snap.authType && `Masuk: ${AUTH_LABEL[snap.authType] ?? snap.authType}`].filter(Boolean);
  }
  const snap = (action.after ?? {}) as AccessSnapshot;
  return [
    yesNo(snap.agentEnabled, "Agen boleh memakai aplikasi", "Agen tidak lagi boleh memakai aplikasi"),
    yesNo(snap.allowWrite, "Agen boleh menjalankan alat yang mengubah data", "Agen hanya boleh alat baca"),
    snap.allowTools?.length ? `Alat bertanda Hapus yang diizinkan: ${snap.allowTools.join(", ")}` : null,
  ].filter(Boolean);
}

/**
 * Permintaan agen atas Aplikasi MCP (fitur terbuka, keputusan user 2026-11-13): sambungkan aplikasi baru atau ubah izin
 * agen. Tidak ada yang berubah sebelum disetujui di sini. Koneksi yang disetujui dibuat belum tersambung: masuk (OAuth)
 * atau token tetap Anda isi di halaman aplikasinya. Tampil di Approval → Usulan Agen dan di Aplikasi MCP.
 */
export function McpRequestsCard() {
  const client = useQueryClient();
  const { data } = useAgentActions("pending");
  const m = useAgentActionMutations();
  const pending = (data ?? []).filter((a) => a.kind === "mcp_connect" || a.kind === "mcp_access");
  if (!pending.length) return null;

  const approve = (action: AgentActionInfo) =>
    m.approve.mutate(action.id, {
      onSuccess: (r) =>
        r.status === "approved"
          ? toast.success(action.kind === "mcp_connect" ? "Koneksi aplikasi dibuat." : "Izin agen diperbarui.", {
              description: r.message,
            })
          : toast.error("Permintaan gagal diterapkan.", { description: r.message }),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => void client.invalidateQueries({ queryKey: queryKeys.mcpConnections }),
    });
  const reject = (action: AgentActionInfo) =>
    m.reject.mutate(
      { id: action.id },
      { onSuccess: () => toast.success("Permintaan ditolak."), onError: (e) => toast.error(errorMessage(e)) },
    );

  return (
    <Card className="grid grid-cols-1 gap-3 border-info/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info">
          <Plug className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Permintaan Aplikasi MCP dari agen ({pending.length})</p>
          <p className="text-xs text-muted-foreground">
            Koneksi baru dibuat belum tersambung — masuk atau isi token tetap oleh Anda. Agen tidak pernah menerima
            kredensial aplikasi.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {pending.map((action) => {
          const slug = action.kind === "mcp_access" ? ((action.after ?? {}) as AccessSnapshot).slug : undefined;
          return (
            <li key={action.id} className="min-w-0 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{action.kind === "mcp_connect" ? "Sambungkan" : "Izin agen"}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium">{action.title}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(action.createdAt)}</span>
              </div>
              {action.reason && (
                <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground">
                  <Bot className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{action.reason}</span>
                </p>
              )}
              <p className="mt-1 text-xs break-words text-muted-foreground">{requestFacts(action).join(" · ")}</p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {slug && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/mcp/apps/${slug}`}>Lihat aplikasi</Link>
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={m.reject.isPending} onClick={() => reject(action)}>
                  <X /> Tolak
                </Button>
                <Button size="sm" disabled={m.approve.isPending} onClick={() => approve(action)}>
                  <Check /> Setujui
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
