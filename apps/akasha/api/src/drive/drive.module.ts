import { Module } from "@nestjs/common";
import { ConnectionsModule } from "../connections/connections.module";
import { ColdStorageService } from "./cold-storage.service";
import { DriveController } from "./drive.controller";
import { DriveService } from "./drive.service";

/** Drive sebagai penyimpanan (docs/AKUN-TERSAMBUNG.md tahap 4). */
@Module({
  imports: [ConnectionsModule],
  controllers: [DriveController],
  providers: [DriveService, ColdStorageService],
})
export class DriveModule {}
