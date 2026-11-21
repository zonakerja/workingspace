import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { RequestCategoriesService } from "./request-categories.service";

export class RequestCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}

/** Kategori pengajuan Approval milik pemilik (bisa ditambah, diubah, diarsipkan). */
@ApiTags("requests")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("request-categories")
export class RequestCategoriesController {
  constructor(private readonly categories: RequestCategoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.categories.list(user.id);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: RequestCategoryDto) {
    await this.categories.create(user.id, dto);
    return this.categories.list(user.id);
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RequestCategoryDto) {
    await this.categories.update(user.id, id, dto);
    return this.categories.list(user.id);
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.categories.remove(user.id, id);
    return this.categories.list(user.id);
  }
}
