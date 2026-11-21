import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { UploadsModule } from "../uploads/uploads.module";
import { RequestCategoriesController } from "./request-categories.controller";
import { RequestCategoriesService } from "./request-categories.service";
import { RequestsController } from "./requests.controller";
import { AssetVerificationService } from "./asset-verification.service";
import { RequestsService } from "./requests.service";

/** Pengajuan, mesin templat & Antrian Verifikasi (docs/AI-AGENT.md tahap 4). */
@Module({
  imports: [AiModule, UploadsModule],
  controllers: [RequestsController, RequestCategoriesController],
  providers: [RequestsService, AssetVerificationService, RequestCategoriesService],
  exports: [RequestsService, AssetVerificationService, RequestCategoriesService],
})
export class RequestsModule {}
