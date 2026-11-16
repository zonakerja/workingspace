import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { SKILL_LIMITS } from "./skill-logic";
import { SkillsService } from "./skills.service";

class SkillFileDto {
  @IsString()
  @MaxLength(SKILL_LIMITS.pathChars)
  path: string;

  @IsString()
  @MaxLength(SKILL_LIMITS.fileChars)
  content: string;
}

class SkillDto {
  /** Teks SKILL.md utuh (frontmatter name + description, lalu instruksi); isian lain menimpa nilainya. */
  @IsOptional()
  @IsString()
  @MaxLength(SKILL_LIMITS.instructionsChars + 2000)
  skillMd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SKILL_LIMITS.nameChars)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SKILL_LIMITS.descriptionChars)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SKILL_LIMITS.instructionsChars)
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SKILL_LIMITS.maxFiles)
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  files?: SkillFileDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class EnabledDto {
  @IsBoolean()
  enabled: boolean;
}

/** Skill Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/skills")
export class SkillsController {
  constructor(
    private readonly caller: CallerService,
    private readonly skills: SkillsService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.skills.list(await this.caller.resolve(req));
  }

  @Patch("builtin/:name")
  async builtin(@Param("name") name: string, @Body() dto: EnabledDto, @Req() req: Request) {
    return this.skills.setBuiltin(await this.caller.resolve(req), name, dto.enabled);
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() req: Request) {
    return this.skills.get(await this.caller.resolve(req), id);
  }

  @Post()
  async create(@Body() dto: SkillDto, @Req() req: Request) {
    return this.skills.create(await this.caller.resolve(req), dto);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: SkillDto, @Req() req: Request) {
    return this.skills.update(await this.caller.resolve(req), id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.skills.remove(await this.caller.resolve(req), id);
  }
}
