import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Request } from "express";
import { memoryStorage } from "multer";
import { CallerService } from "../common/caller";
import { ProjectsService } from "./projects.service";

class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  instructions?: string;
}

class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  instructions?: string;
}

/** Proyek Akai web (sesi web; ubah data wajib header X-Akai-Web). docs/AKAI.md §8. */
@Controller("api/projects")
export class ProjectsController {
  constructor(
    private readonly caller: CallerService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.projects.list(await this.caller.resolve(req));
  }

  @Post()
  async create(@Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projects.create(await this.caller.resolve(req), dto);
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() req: Request) {
    return this.projects.get(await this.caller.resolve(req), id);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateProjectDto, @Req() req: Request) {
    return this.projects.update(await this.caller.resolve(req), id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: Request) {
    await this.projects.remove(await this.caller.resolve(req), id);
  }

  @Post(":id/files")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  async addFile(@Param("id") id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.projects.addFile(await this.caller.resolve(req), id, file);
  }

  @Delete(":id/files/:fileId")
  @HttpCode(204)
  async removeFile(@Param("id") id: string, @Param("fileId") fileId: string, @Req() req: Request) {
    await this.projects.removeFile(await this.caller.resolve(req), id, fileId);
  }
}
