import { CheckCheck, EyeOff, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentMenuMutations, useAgentMenus, useAgentStatus } from "@/data/use-agent";
import { errorMessage } from "@/lib/api/client";
import type { AgentMenu } from "@/lib/api/endpoints";
import { getAppIcon } from "@/lib/icons/icon-registry";
import { EkinerjaFillRequestsCard } from "@/features/kinerja/fill-requests-card";
import { DeleteRequestsCard } from "./delete-requests-card";

const PLACEMENT_LABELS: Record<AgentMenu["placement"], string> = {
  workflow: "AI Agent → Workflow",
  connection: "Connection & MCP",
  ekinerja: "e-Kinerja → Workflow",
};

/**
 * Approval → Usulan Agen: fitur non-native yang dibuat Hermes. Tidak ada yang tampil sebelum disetujui di sini, dan
 * agen tidak bisa menyentuh fitur native. Agen yang mengubah fitur aktif mengembalikannya ke daftar ini.
 */
export function ProposalsTab() {
  const { data: status } = useAgentStatus();
  const { data: menus, isLoading } = useAgentMenus();
  const m = useAgentMenuMutations();
  const [removing, setRemoving] = useState<AgentMenu | null>(null);
  const setMenuStatus = (menu: AgentMenu, next: AgentMenu["status"]) =>
    m.setStatus.mutate(
      { id: menu.id, status: next },
      {
        onSuccess: () => toast.success(next === "active" ? `${menu.label} disetujui.` : `${menu.label} disembunyikan.`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  if (status && !status.owner) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <DeleteRequestsCard />
        <EkinerjaFillRequestsCard />
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Usulan fitur agen hanya untuk pemilik agen (HERMES_OWNER_EMAIL).
        </Card>
      </div>
    );
  }
  const drafts = (menus ?? []).filter((x) => x.status === "draft");
  const active = (menus ?? []).filter((x) => x.status === "active");

  return (
    <div className="grid grid-cols-1 gap-3">
      <DeleteRequestsCard />
      <EkinerjaFillRequestsCard />
      <Card className="flex items-start gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-module-soft text-module">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            Agen hanya bisa membuat fitur non-native, dan semuanya menunggu persetujuan Anda
          </p>
          <p className="mt-1 text-muted-foreground">
            Workspace, Sistem, Tools, serta e-Kinerja, SRIKANDI, dan SIMAN adalah fitur native yang tidak bisa diubah
            agen. Periksa langkah kerja dan isian modalnya sebelum menyetujui.
          </p>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <>
          <p className="text-sm font-semibold">Menunggu persetujuan ({drafts.length})</p>
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada usulan baru.</p>}
          {drafts.map((menu) => (
            <ProposalCard key={menu.id} menu={menu}>
              <Button size="sm" onClick={() => setMenuStatus(menu, "active")}>
                <CheckCheck /> Setujui
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRemoving(menu)}>
                <Trash2 /> Tolak
              </Button>
            </ProposalCard>
          ))}

          <p className="mt-2 text-sm font-semibold">Sudah aktif ({active.length})</p>
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada fitur buatan agen yang aktif.</p>
          )}
          {active.map((menu) => (
            <ProposalCard key={menu.id} menu={menu}>
              <Button size="sm" variant="outline" asChild>
                <Link
                  to={
                    menu.placement === "connection"
                      ? `/custom/${menu.slug}`
                      : menu.placement === "ekinerja"
                        ? "/kinerja/workflow"
                        : "/agent/workflow"
                  }
                >
                  Buka
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMenuStatus(menu, "draft")}>
                <EyeOff /> Sembunyikan
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setRemoving(menu)}
                aria-label={`Hapus ${menu.label}`}
              >
                <Trash2 />
              </Button>
            </ProposalCard>
          ))}
        </>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Hapus fitur buatan agen?"
        itemName={removing?.label}
        description="Fitur ini hilang dari LifeOS. Skill dan hasil kerja agen yang sudah ada tidak ikut terhapus."
        confirmLabel="Hapus"
        onConfirm={() =>
          removing &&
          m.remove.mutate(removing.id, {
            onSuccess: () => toast.success("Fitur dihapus."),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function ProposalCard({ menu, children }: { menu: AgentMenu; children: React.ReactNode }) {
  const Icon = getAppIcon(menu.icon, "bot").icon;
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 shrink-0 text-module" />
        <span className="min-w-0 truncate font-semibold">{menu.label}</span>
        <Badge variant="outline">{PLACEMENT_LABELS[menu.placement]}</Badge>
        <span className="ml-auto flex shrink-0 flex-wrap gap-1">{children}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{menu.description}</p>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Skill <code>{menu.skill}</code> · {menu.form.length} isian modal · lihat rincian
        </summary>
        <p className="mt-1 rounded-md bg-muted/40 p-2 whitespace-pre-line">{menu.instructions}</p>
        {menu.form.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {menu.form.map((f) => (
              <li key={f.name}>
                {f.label} ({f.type}
                {f.required ? ", wajib" : ""})
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
