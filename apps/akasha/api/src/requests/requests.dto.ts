import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { REQUEST_STATUSES } from "./request-logic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRequestDto {
  @ApiPropertyOptional({
    description: 'Kunci kategori pengajuan; kosong / "auto" = ditentukan otomatis dari kata kunci',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: "Judul wajib diisi." })
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  applicant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  groupCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  letterNumber?: string;

  @ApiPropertyOptional({ description: "YYYY-MM-DD" })
  @IsOptional()
  @Matches(YMD, { message: "Tanggal surat harus YYYY-MM-DD." })
  letterDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @ApiPropertyOptional({ description: "Isi pesan / permintaan pemohon" })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  message?: string;

  @ApiPropertyOptional({ type: [String], description: "ID berkas yang sudah diunggah (context `request`)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  uploadIds?: string[];
}

export class ChecklistCheckDto {
  @ApiPropertyOptional({ enum: ["lolos", "bermasalah"], nullable: true, description: "null = batalkan tanda" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(["lolos", "bermasalah"])
  result?: "lolos" | "bermasalah" | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateRequestDto {
  @ApiPropertyOptional({ description: "Kunci kategori pengajuan" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  applicant?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  groupCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  letterNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== "")
  @Matches(YMD, { message: "Tanggal surat harus YYYY-MM-DD." })
  letterDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  subject?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(20_000)
  message?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(20_000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Telaah (Markdown) hasil suntingan pengguna" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100_000)
  review?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Konsep jawaban (Markdown) hasil suntingan pengguna" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100_000)
  draftReply?: string | null;

  @ApiPropertyOptional({ enum: REQUEST_STATUSES })
  @IsOptional()
  @IsIn(REQUEST_STATUSES, { message: "Status tidak dikenal." })
  status?: string;

  @ApiPropertyOptional({ description: "Catatan riwayat saat status berubah (mis. alasan ditolak)" })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  statusNote?: string;

  @ApiPropertyOptional({ type: [String], description: "Daftar lengkap berkas pemohon (menggantikan yang lama)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  uploadIds?: string[];
}

export class ListRequestsQueryDto {
  @ApiPropertyOptional({ enum: REQUEST_STATUSES })
  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: string;
}

export class TemplateRefDto {
  @ApiProperty({ description: "ID templat dokumen (Tools → ONLYOFFICE → Templat, format DOCX)" })
  @IsString()
  @MaxLength(40)
  templateId: string;
}

export class CreateRequestDocumentDto extends TemplateRefDto {
  @ApiProperty({
    description:
      "Nilai penanda & paragraf petunjuk { nama: teks }; tabel berulang ${#nama}…${/nama} = { nama: [{ penanda: teks }] }",
  })
  @IsObject()
  values: Record<string, string | Record<string, string>[]>;

  @ApiPropertyOptional({ description: "Nama berkas (tanpa .docx)" })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;
}
