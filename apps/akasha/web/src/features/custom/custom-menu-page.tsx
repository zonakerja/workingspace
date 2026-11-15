import { Bot } from "lucide-react";
import { Link, useParams } from "react-router";
import { ModulePage } from "@/components/layout/module-page";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useAgentMenus } from "@/data/use-agent";
import { WorkflowPanel } from "@/features/agent/workflow-panel";

/** Connection & MCP → koneksi buatan agen (`/custom/:slug`): fitur non-native yang sudah disetujui di Approval. */
export function Component() {
  const { slug } = useParams();
  const { data: menus, isLoading } = useAgentMenus();
  const menu = menus?.find((m) => m.slug === slug && m.status === "active" && m.placement === "connection");
  return (
    <ModulePage module="custom" title={menu?.label} description={menu?.description}>
      {isLoading ? (
        <Spinner className="m-6" />
      ) : menu ? (
        <WorkflowPanel menu={menu} />
      ) : (
        <Empty className="rounded-2xl border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>Menu ini belum aktif</EmptyTitle>
            <EmptyDescription>Menu tidak ditemukan atau belum disetujui di Approval → Usulan Agen.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/requests/proposals">Buka Usulan Agen</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </ModulePage>
  );
}
