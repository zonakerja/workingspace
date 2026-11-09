import { Workflow } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useAgentMenus } from "@/data/use-agent";
import { WorkflowPanel } from "./workflow-panel";

/** AI Agent → Workflow: proses yang dibangun agen dan sudah disetujui. Hasil yang perlu keputusan masuk ke Approval. */
export function WorkflowTab() {
  const { data: menus, isLoading } = useAgentMenus();
  if (isLoading) return <Spinner className="m-6" />;
  const active = (menus ?? []).filter((m) => m.status === "active" && m.placement === "workflow");
  const waiting = (menus ?? []).filter((m) => m.status === "draft").length;
  return (
    <div className="grid grid-cols-1 gap-3">
      {waiting > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
          {waiting} usulan agen menunggu persetujuan.{" "}
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
            <EmptyTitle>Belum ada workflow</EmptyTitle>
            <EmptyDescription>
              Ajarkan prosesnya di tab Chat, lalu minta agen membuatkan workflow. Usulannya tampil di sini setelah Anda
              setujui di Approval.
            </EmptyDescription>
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
