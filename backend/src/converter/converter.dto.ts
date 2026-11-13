import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsOptional } from "class-validator";
import type { EnhanceScope } from "./markdown-enhance";
import {
  ENHANCE_SCOPES,
  PDF_MODES,
  RECONVERT_SCOPES,
  type ConverterMode,
  type ConverterPdfMode,
  type ReconvertScope,
} from "./converter-logic";

export class UpdateConverterPrefsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(PDF_MODES)
  pdfMode?: ConverterPdfMode;

  @IsOptional()
  @IsBoolean()
  aiOcrFallback?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEnhance?: boolean;

  @IsOptional()
  @IsIn(ENHANCE_SCOPES)
  aiEnhanceScope?: EnhanceScope;
}

export class ConvertFileDto {
  @IsOptional()
  @IsIn(["auto", "markitdown", "docling"])
  mode?: ConverterMode;

  @IsOptional()
  @IsIn(PDF_MODES)
  pdfMode?: ConverterPdfMode;

  /** Rapikan hasil dengan AI (multipart → string "true"/"false"). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  enhance?: boolean;

  /** Hitung token (Gemini countTokens): berkas mentah vs Markdown vs hasil rapikan. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  compareTokens?: boolean;
}

export class ReconvertDto {
  @IsIn(RECONVERT_SCOPES)
  scope!: ReconvertScope;
}
