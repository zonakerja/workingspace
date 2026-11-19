import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, Max, Min, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { SMART_SEARCH_MODES, type SmartSearchMode } from "../index/smart-search";

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: "Indeks pengetahuan (RAG) dengan model Embedding di Akai" })
  @IsOptional()
  @IsBoolean()
  indexEnabled?: boolean;
}

/** Field teks pada request multipart `POST /ai/generate` (berkas di field `files`). */
export class GenerateAiDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: "Prompt wajib diisi." })
  @MaxLength(1_000_000)
  prompt: string;
}

export class SmartSearchDto {
  @ApiProperty()
  @IsString()
  @MinLength(2, { message: "Ketik minimal 2 huruf." })
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({ enum: SMART_SEARCH_MODES, default: "text" })
  @IsOptional()
  @IsIn(SMART_SEARCH_MODES)
  mode?: SmartSearchMode;
}

export class SearchAiIndexDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: "Kata kunci wajib diisi." })
  @MaxLength(500)
  q: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
