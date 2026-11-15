import { ClipboardList } from "lucide-react";
import { HeroStat, ModulePage } from "@/components/layout/module-page";
import { useActionPlanEntries, useSkpTargets } from "@/data/collections";
import { entryStatus } from "./lib/action-plan";
import { RobotSettings } from "@/features/tools/robot/robot-settings";
import { ActionPlanBoard } from "./action-plan-board";
import { AssessmentTab } from "./assessment-tab";
import { EkinerjaFillRequestsCard } from "./fill-requests-card";
import { KinerjaWorkflowTab } from "./kinerja-workflow-tab";

/**
 * Connection & MCP → e-Kinerja: rencana aksi bulanan e-Kinerja (produk jadi dari Working Space) + SKP & RHK dari robot.
 * Fitur terbuka untuk agen: workflow buatan agen (tab Workflow) dan permintaan isi dari agen (kartu di Rencana Aksi).
 */
export function Component() {
  const { items } = useActionPlanEntries();
  const { items: targets } = useSkpTargets();
  // Status dihitung ulang seperti di papan (entri lama tanpa realisasi = belum lengkap)
  const ready = items.filter(
    (e) =>
      !e.proposed &&
      entryStatus(
        e,
        targets.find((t) => t.id === e.targetId),
      ) === "ready",
  ).length;
  return (
    <ModulePage
      module="kinerja"
      meta={
        <HeroStat>
          <ClipboardList className="size-3.5" /> {ready} siap diisikan
        </HeroStat>
      }
    >
      {(tab) =>
        tab === "connector" ? (
          <RobotSettings systems={["ekinerja"]} />
        ) : tab === "assessment" ? (
          <AssessmentTab />
        ) : tab === "workflow" ? (
          <KinerjaWorkflowTab />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <EkinerjaFillRequestsCard />
            <ActionPlanBoard />
          </div>
        )
      }
    </ModulePage>
  );
}
