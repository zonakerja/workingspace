import { Workflow } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useAgentMenus } from "@/data/use-agent";
import { WorkflowPanel } from "@/features/agent/workflow-panel";

/**
 * e-Kinerja → Workflow: e-Kinerja adalah fitur terbuka untuk agen. Workflow buatan agen berpenempatan `ekinerja`
 * (mis. menyusun narasi renaksi bulanan) tampil di sini setelah disetujui di Approval → Usulan Agen.
 */
export function KinerjaWorkflowTab() {
  const { data: menus, isLoading } = useAgentMenus();
  if (isLoading) return <Spinner className="m-6" />;
  const active = (menus ?? []).filter((m) => m.status === "active" && m.placement === "ekinerja");
  const waiting = (menus ?? []).filter((m) => m.status === "draft" && m.placement === "ekinerja").length;
  return (
    <div className="grid grid-cols-1 gap-3">
      {waiting > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
          {waiting} usulan workflow e-Kinerja menunggu persetujuan.{" "}
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
            <EmptyTitle>Belum ada workflow e-Kinerja</EmptyTitle>
            <EmptyDescription>
              Minta agen di AI Agent → Chat membuat workflow untuk e-Kinerja, misalnya menyusun uraian renaksi bulan ini
              atau memeriksa bukti yang belum lengkap. Agen juga bisa menjalankan robot e-Kinerja (ambil SKP, pantau,
              periksa) bila izin "Robot e-Kinerja" diaktifkan; pengisian tetap menunggu persetujuan Anda.
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
