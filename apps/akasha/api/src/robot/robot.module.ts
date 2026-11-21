import { Module } from "@nestjs/common";
import { RecordsModule } from "../records/records.module";
import { UploadsModule } from "../uploads/uploads.module";
import { RobotClient } from "./robot-client";
import { RobotController } from "./robot.controller";
import { EkinerjaAgentService } from "./ekinerja-agent.service";
import { SimanAgentService } from "./siman-agent.service";
import { SimanDocumentsService } from "./siman-documents.service";
import { SrikandiAgentService } from "./srikandi-agent.service";
import { RenaksiProposalsService } from "./renaksi-proposals.service";
import { RobotService } from "./robot.service";

/** Konektor robot SRIKANDI, e-Kinerja & SIMAN lewat service robot Playwright (docs/AI-AGENT.md tahap 6 §21). */
@Module({
  imports: [RecordsModule, UploadsModule],
  controllers: [RobotController],
  providers: [
    RobotService,
    RobotClient,
    EkinerjaAgentService,
    SrikandiAgentService,
    SimanAgentService,
    SimanDocumentsService,
    RenaksiProposalsService,
  ],
  exports: [
    RobotService,
    EkinerjaAgentService,
    SrikandiAgentService,
    SimanAgentService,
    SimanDocumentsService,
    RenaksiProposalsService,
  ],
})
export class RobotModule {}
