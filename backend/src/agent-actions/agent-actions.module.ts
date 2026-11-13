import { Module } from "@nestjs/common";
import { McpConnectionsModule } from "../mcp-connections/mcp-connections.module";
import { RecordsModule } from "../records/records.module";
import { RobotModule } from "../robot/robot.module";
import { SharingModule } from "../sharing/sharing.module";
import { UploadsModule } from "../uploads/uploads.module";
import { AgentActionsController } from "./agent-actions.controller";
import { AgentActionsService } from "./agent-actions.service";

@Module({
  imports: [McpConnectionsModule, RecordsModule, RobotModule, SharingModule, UploadsModule],
  controllers: [AgentActionsController],
  providers: [AgentActionsService],
  exports: [AgentActionsService],
})
export class AgentActionsModule {}
