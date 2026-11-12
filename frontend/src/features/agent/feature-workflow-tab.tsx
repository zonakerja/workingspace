import { Workflow } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useAgentMenus } from "@/data/use-agent";
import type { AgentMenu } from "@/lib/api/endpoints";
import { WorkflowPanel } from "./workflow-panel";

/**
 * Tab Workflow di fitur native yang terbuka untuk agen (e-Kinerja, SRIKANDI): workflow buatan agen dengan penempatan
 * fitur itu tampil di sini setelah disetujui di Approval → Usulan Agen.
 */
export function FeatureWorkflowTab({
  placement,
  feature,
  hint,
}: {
  placement: Exclude<AgentMenu["placement"], "workflow" | "connection">;
  feature: string;
  hint: string;
}) {
  const { data: menus, isLoading } = useAgentMenus();
  if (isLoading) return <Spinner className="m-6" />;
  const active = (menus ?? []).filter((m) => m.status === "active" && m.placement === placement);
  const waiting = (menus ?? []).filter((m) => m.status === "draft" && m.placement === placement).length;
  return (
    <div className="grid grid-cols-1 gap-3">
      {waiting > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
          {waiting} usulan workflow {feature} menunggu persetujuan.{" "}
          <Link className="font-semibold underline" to="/requests/proposals">
            Buka Usulan Agen
          </Link>
        </p>
      )}
      {active.length ? (
        active.map((menu) => <WorkflowPanel key={menu.id} menu={menu} />)
      ) : (
        <Empty className="rounded-2xl border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Workflow />
            </EmptyMedia>
            <EmptyTitle>Belum ada workflow {feature}</EmptyTitle>
            <EmptyDescription>{hint}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/agent/chat">Buka Chat</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}
