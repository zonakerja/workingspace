import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { RecordsModule } from "../records/records.module";
import { RobotModule } from "../robot/robot.module";
import { SharingModule } from "../sharing/sharing.module";
import { UploadsModule } from "../uploads/uploads.module";
import { AgentActionsController } from "./agent-actions.controller";
import { AgentActionsService } from "./agent-actions.service";

@Module({
  imports: [MailModule, RecordsModule, RobotModule, SharingModule, UploadsModule],
  controllers: [AgentActionsController],
  providers: [AgentActionsService],
  exports: [AgentActionsService],
})
export class AgentActionsModule {}
