import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { ConnectionsModule } from "../connections/connections.module";
import { RecordsModule } from "../records/records.module";
import { MailInboxService } from "./mail-inbox.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";

@Module({
  imports: [AiModule, RecordsModule, ConnectionsModule],
  controllers: [MailController],
  providers: [MailService, MailInboxService],
  exports: [MailService, MailInboxService],
})
export class MailModule {}
