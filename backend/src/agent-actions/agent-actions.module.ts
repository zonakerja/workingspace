import { Module } from "@nestjs/common";
import { RecordsModule } from "../records/records.module";
import { SharingModule } from "../sharing/sharing.module";
import { UploadsModule } from "../uploads/uploads.module";
import { AgentActionsController } from "./agent-actions.controller";
import { AgentActionsService } from "./agent-actions.service";

@Module({
  imports: [RecordsModule, SharingModule, UploadsModule],
  controllers: [AgentActionsController],
  providers: [AgentActionsService],
  exports: [AgentActionsService],
})
export class AgentActionsModule {}
