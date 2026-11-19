import { useQueryClient } from "@tanstack/react-query";
import { Activity, BotMessageSquare, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { HeroStat, ModulePage } from "@/components/layout/module-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useAgentRuns, useAgentSkills, useAgentStatus } from "@/data/use-agent";
import { queryKeys } from "@/data/query-keys";
import type { AgentStatus } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { Link } from "react-router";
import { AgentSetupCard } from "./agent-setup-card";
import { WorkflowTab } from "./workflow-tab";
import { AgentChat } from "./agent-chat";
import { ActionHistoryTab } from "./action-history-tab";

/**
 * AI Agent: antarmuka Akasha untuk agen Hermes (docs/AI-AGENT.md §23) — chat, status & skill, tugas
 * terakhir. Hermes bekerja dengan data Akasha lewat MCP; hasil resmi selalu masuk Approval untuk diperiksa pemilik.
 */
export function Component() {
  const { data: status, isLoading } = useAgentStatus();
  const ready = !!status?.configured && !!status.owner && !!status.reachable;
  return (
    <ModulePage
      module="agent"
      meta={
        <HeroStat>
          <Activity className="size-3.5" />{" "}
          {isLoading
            ? "Memeriksa agen…"
            : ready
              ? `Hermes aktif · ${status?.akashaSkills ?? 0} skill Akasha`
              : "Agen tidak aktif"}
        </HeroStat>
      }
    >
      {(tab) =>
        tab === "actions" ? (
          <ActionHistoryTab />
        ) : !status ? null : tab === "chat" && status.configured && status.owner ? (
          <div className="flex flex-col gap-3">
            {!ready && <NotReady status={status} compact />}
            <AgentChat canSend={ready} />
          </div>
        ) : !ready && tab !== "status" ? (
          <NotReady status={status} />
        ) : tab === "status" ? (
          <StatusTab status={status} />
        ) : tab === "workflow" ? (
          <WorkflowTab />
        ) : (
          <AgentChat canSend={ready} />
        )
      }
    </ModulePage>
  );
}

function NotReady({ status, compact }: { status: AgentStatus; compact?: boolean }) {
  const reason = !status.configured
    ? "Agen belum diatur di server (HERMES_URL & HERMES_API_KEY)."
    : !status.owner
      ? "AI Agent hanya untuk pemilik agen (HERMES_OWNER_EMAIL) — Hermes bekerja dengan data akun pemilik."
      : "Hermes tidak menyala atau tidak dapat dihubungi.";
  if (compact)
    return (
      <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
        {reason} Riwayat percakapan tetap bisa dibaca; kirim pesan setelah Hermes menyala.
      </p>
    );
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotMessageSquare />
        </EmptyMedia>
        <EmptyTitle>Agen belum siap</EmptyTitle>
        <EmptyDescription>
          {reason}
          {status.configured && status.owner && (
            <>
              {" "}
              Nyalakan dari PowerShell:{" "}
              <code>wsl -e sh /mnt/d/Development/Application/workingspace/infra/hermes/up.sh</code>
            </>
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function StatusTab({ status }: { status: AgentStatus }) {
  const ready = status.configured && status.owner && status.reachable;
  const { data: skills } = useAgentSkills(ready);
  const { data: runs } = useAgentRuns(ready);
  const client = useQueryClient();
  const akasha = (skills ?? []).filter((s) => s.akasha);
  const others = (skills ?? []).filter((s) => !s.akasha);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {status.configured && status.owner && <AgentSetupCard status={status} />}
      <SectionCard
        icon={Activity}
        title="Status Hermes"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void client.invalidateQueries({ queryKey: queryKeys.agentStatus })}
          >
            Periksa ulang
          </Button>
        }
        contentClassName="grid grid-cols-1 gap-2 text-sm"
      >
        <StatusRow ok={status.configured} label="Diatur di server" />
        <StatusRow ok={status.owner} label="Akun ini pemilik agen" />
        <StatusRow
          ok={status.reachable}
          label={status.reachable ? `Hermes aktif (${status.health})` : "Hermes menyala"}
        />
        {status.error && <p className="text-xs text-warning">{status.error}</p>}
        <p className="text-xs text-muted-foreground">
          Hermes berjalan sebagai container <code>akasha-hermes</code> (profile <code>agent</code>). Model AI-nya
          dipanggil lewat Akasha → Akai (tugas Agen di Akai → Model).
        </p>
      </SectionCard>

      <SectionCard
        icon={Sparkles}
        title="Skill"
        description="Skill Akasha = prosedur kerja agen di repo (agents/hermes/skills/). Jalankan dari detail pengajuan di Approval."
        contentClassName="grid grid-cols-1 gap-1.5"
      >
        {!ready ? (
          <p className="text-sm text-muted-foreground">Nyalakan Hermes untuk melihat skill.</p>
        ) : akasha.length === 0 ? (
          <p className="text-sm text-warning">Skill Akasha belum terbaca — periksa mount folder skill.</p>
        ) : (
          akasha.map((s) => (
            <div key={s.name} className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
            </div>
          ))
        )}
        {others.length > 0 && <p className="text-xs text-muted-foreground">+ {others.length} skill bawaan Hermes</p>}
      </SectionCard>

      <SectionCard
        icon={BotMessageSquare}
        title="Tugas agen terakhir"
        description="Sejak backend dinyalakan. Rincian tiap pemanggilan alat ada di Pengaturan → Integrasi → Aktivitas agen."
        className="lg:col-span-2"
        contentClassName="grid grid-cols-1 gap-1.5"
      >
        {!runs?.length ? (
          <p className="text-sm text-muted-foreground">Belum ada tugas.</p>
        ) : (
          runs.map((r) => (
            <div key={r.runId} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-sm">
              <Badge variant="outline">{r.kind === "skill" ? r.skill : "chat"}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {r.requestId ? (
                  <Link className="hover:underline" to={`/requests/queue?request=${r.requestId}`}>
                    Pengajuan {r.requestId.slice(-6)}
                  </Link>
                ) : (
                  r.input
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(r.startedAt)}</span>
              <Badge variant="secondary">{r.status}</Badge>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2">
      {ok ? <CircleCheck className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
      {label}
    </p>
  );
}
