import { forwardRef, Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { ExtractionModule } from "../extraction/extraction.module";
import { ConverterController } from "./converter.controller";
import { ConverterLibraryService } from "./converter-library.service";
import { ConverterService } from "./converter.service";

/**
 * ConverterClient & MarkdownEnhancerService disediakan ExtractionModule (dipakai worker ekstraksi) agar tidak terjadi impor
 * melingkar; AiService untuk menghitung token (Bandingkan token).
 */
@Module({
  imports: [ExtractionModule, forwardRef(() => AiModule)],
  controllers: [ConverterController],
  providers: [ConverterService, ConverterLibraryService],
})
export class ConverterModule {}
