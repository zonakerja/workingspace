import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Caller } from "../common/caller";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BUILTIN_SKILLS } from "./builtin-skills";
import {
  SKILL_LIMITS,
  type SkillDef,
  type SkillFile,
  cleanFilePath,
  parseSkillMd,
  skillSlug,
  toSkillMd,
  validateSkill,
} from "./skill-logic";

export type SkillInput = {
  skillMd?: string;
  name?: string;
  description?: string;
  instructions?: string;
  files?: SkillFile[];
  enabled?: boolean;
};

type SkillRow = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: Prisma.JsonValue;
  enabled: boolean;
  updatedAt: Date;
};

const filesOf = (value: Prisma.JsonValue): SkillFile[] =>
  Array.isArray(value)
    ? value.flatMap((f) =>
        f && typeof f === "object" && !Array.isArray(f) && typeof f.path === "string" && typeof f.content === "string"
          ? [{ path: f.path, content: f.content }]
          : [],
      )
    : [];

const disabledOf = (value: Prisma.JsonValue | undefined) =>
  new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/**
 * Skill Akai (6b.6, docs/AKAI.md §8): skill bawaan (kode) + skill buatan pemilik (tabel `skills`, format SKILL.md + berkas teks).
 * Skill aktif tampil sebagai katalog di prompt sistem chat; model memuat isinya lewat alat `akai__skill`. Hanya sesi Akai web.
 */
@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Skill hanya untuk Akai web.");
  }

  private view(row: SkillRow) {
    const files = filesOf(row.files);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      files: files.map((f) => ({ path: f.path, size: f.content.length })),
      enabled: row.enabled,
      builtin: false,
      updatedAt: row.updatedAt,
    };
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const [account, rows] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: caller.account.id }, select: { disabledSkills: true } }),
      this.prisma.skill.findMany({ where: { accountId: caller.account.id }, orderBy: { name: "asc" } }),
    ]);
    const disabled = disabledOf(account?.disabledSkills);
    return {
      builtin: BUILTIN_SKILLS.map((s) => ({
        id: null,
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        files: [],
        enabled: !disabled.has(s.name),
        builtin: true,
        updatedAt: null,
      })),
      custom: rows.map((r) => this.view(r)),
    };
  }

  async get(caller: Caller, id: string) {
    this.requireWeb(caller);
    const row = await this.prisma.skill.findFirst({ where: { id, accountId: caller.account.id } });
    if (!row) throw new NotFoundException("Skill tidak ditemukan.");
    return { ...this.view(row), fileContents: filesOf(row.files), skillMd: toSkillMd(row) };
  }

  /** Gabungkan masukan (SKILL.md dan/atau isian) dengan nilai lama, lalu periksa. */
  private resolve(input: SkillInput, current?: SkillDef): SkillDef {
    const parsed = input.skillMd ? parseSkillMd(input.skillMd) : null;
    const name = skillSlug(input.name ?? parsed?.name ?? current?.name ?? "");
    const files = (input.files ?? current?.files ?? []).map((f) => ({
      path: cleanFilePath(f.path) ?? f.path,
      content: f.content,
    }));
    const skill: SkillDef = {
      name,
      description: (input.description ?? parsed?.description ?? current?.description ?? "").trim(),
      instructions: (
        input.instructions ??
        (parsed ? parsed.instructions : undefined) ??
        current?.instructions ??
        ""
      ).trim(),
      files,
    };
    const error = validateSkill(skill);
    if (error) throw new BadRequestException(error);
    return skill;
  }

  async create(caller: Caller, input: SkillInput) {
    this.requireWeb(caller);
    const skill = this.resolve(input);
    const count = await this.prisma.skill.count({ where: { accountId: caller.account.id } });
    if (count >= SKILL_LIMITS.maxSkills) throw new BadRequestException(`Maks. ${SKILL_LIMITS.maxSkills} skill.`);
    if (await this.prisma.skill.findFirst({ where: { accountId: caller.account.id, name: skill.name } }))
      throw new ConflictException(`Skill bernama ${skill.name} sudah ada.`);
    const row = await this.prisma.skill.create({
      data: {
        accountId: caller.account.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        files: skill.files as unknown as Prisma.InputJsonValue,
        enabled: input.enabled ?? true,
      },
    });
    return this.get(caller, row.id);
  }

  async update(caller: Caller, id: string, input: SkillInput) {
    this.requireWeb(caller);
    const row = await this.prisma.skill.findFirst({ where: { id, accountId: caller.account.id } });
    if (!row) throw new NotFoundException("Skill tidak ditemukan.");
    const skill = this.resolve(input, { ...row, files: filesOf(row.files) });
    if (
      skill.name !== row.name &&
      (await this.prisma.skill.findFirst({ where: { accountId: caller.account.id, name: skill.name } }))
    )
      throw new ConflictException(`Skill bernama ${skill.name} sudah ada.`);
    await this.prisma.skill.update({
      where: { id },
      data: {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        files: skill.files as unknown as Prisma.InputJsonValue,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
    return this.get(caller, id);
  }

  async remove(caller: Caller, id: string) {
    this.requireWeb(caller);
    const done = await this.prisma.skill.deleteMany({ where: { id, accountId: caller.account.id } });
    if (!done.count) throw new NotFoundException("Skill tidak ditemukan.");
  }

  /** Nyalakan / matikan skill bawaan untuk akun ini. */
  async setBuiltin(caller: Caller, name: string, enabled: boolean) {
    this.requireWeb(caller);
    if (!BUILTIN_SKILLS.some((s) => s.name === name)) throw new NotFoundException("Skill bawaan tidak ditemukan.");
    const account = await this.prisma.account.findUnique({
      where: { id: caller.account.id },
      select: { disabledSkills: true },
    });
    const disabled = disabledOf(account?.disabledSkills);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    await this.prisma.account.update({
      where: { id: caller.account.id },
      data: { disabledSkills: [...disabled] },
    });
    return this.list(caller);
  }

  /** Skill aktif akun (bawaan yang tidak dimatikan + buatan pemilik yang menyala), isi lengkap — dipakai chat. */
  async active(accountId: string): Promise<SkillDef[]> {
    const [account, rows] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: accountId }, select: { disabledSkills: true } }),
      this.prisma.skill.findMany({ where: { accountId, enabled: true }, orderBy: { name: "asc" } }),
    ]);
    const disabled = disabledOf(account?.disabledSkills);
    return [
      ...BUILTIN_SKILLS.filter((s) => !disabled.has(s.name)),
      ...rows.map((r) => ({
        name: r.name,
        description: r.description,
        instructions: r.instructions,
        files: filesOf(r.files),
      })),
    ];
  }
}
