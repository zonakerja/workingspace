import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { TrashService } from "./trash.service";

class TrashSelectorDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchId?: string;
}

class TrashPurgeDto extends TrashSelectorDto {
  @ApiProperty({ required: false, description: "true = kosongkan seluruh Sampah" })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

/** Sampah milik user: daftar, pulihkan, hapus permanen. */
@ApiTags("trash")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("trash")
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.trash.list(user);
  }

  @Post("restore")
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Body() dto: TrashSelectorDto) {
    return this.trash.restore(user, dto);
  }

  @Post("purge")
  @HttpCode(200)
  purge(@CurrentUser() user: AuthUser, @Body() dto: TrashPurgeDto) {
    return this.trash.purge(user, dto);
  }
}
