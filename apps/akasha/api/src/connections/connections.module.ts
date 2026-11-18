import { Module } from "@nestjs/common";
import { RecordsModule } from "../records/records.module";
import { CalendarSyncService } from "./calendar-sync.service";
import { ConnectionsController } from "./connections.controller";
import { OAuthService } from "./oauth.service";

@Module({
  imports: [RecordsModule],
  controllers: [ConnectionsController],
  providers: [OAuthService, CalendarSyncService],
  exports: [OAuthService],
})
export class ConnectionsModule {}
