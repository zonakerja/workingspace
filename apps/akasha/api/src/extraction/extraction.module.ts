import { forwardRef, Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { ExtractionQueueService } from "./extraction-queue.service";
import { ExtractionWorkerService } from "./extraction-worker.service";
import { OfficeTextConverter } from "../office/office-text-converter";
import { ConverterClient } from "../converter/converter-client";
import { MarkdownEnhancerService } from "../converter/markdown-enhancer.service";

@Module({
  imports: [forwardRef(() => AiModule)],
  providers: [
    ExtractionQueueService,
    ExtractionWorkerService,
    OfficeTextConverter,
    ConverterClient,
    MarkdownEnhancerService,
  ],
  // OfficeTextConverter juga dipakai OfficeService (dokumen dari templat format lain)
  exports: [ExtractionQueueService, OfficeTextConverter, ConverterClient, MarkdownEnhancerService],
})
export class ExtractionModule {}
