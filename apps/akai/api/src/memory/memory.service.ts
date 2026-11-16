import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Caller } from "../common/caller";
import { GatewayService } from "../gateway/gateway.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  MEMORY_MAX_CHARS,
  MEMORY_MAX_ITEMS,
  extractionPrompt,
  isSensitive,
  memoryBlock,
  parseExtraction,
  worthExtracting,
} from "./memory-logic";

export type MemoryUpdate = { op: "add" | "remove"; content: string };

/**
 * Memori Akai (6b.3, docs/AKAI.md §8): fakta tentang pengguna yang dicatat otomatis setelah setiap pertukaran chat (tugas `memory`,
 * kosong = tugas Umum) atau ditambah pemilik, dipakai di prompt sistem semua percakapan. Bisa dimatikan per akun.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
  ) {}

  private requireWeb(caller: Caller) {
    if (caller.clientId !== "web") throw new ForbiddenException("Memori hanya untuk Akai web.");
  }

  private items(accountId: string) {
    return this.prisma.memory.findMany({
      where: { accountId },
      orderBy: { updatedAt: "desc" },
      take: MEMORY_MAX_ITEMS,
    });
  }

  async list(caller: Caller) {
    this.requireWeb(caller);
    const account = await this.prisma.account.findUnique({
      where: { id: caller.account.id },
      select: { memoryEnabled: true },
    });
    return { enabled: account?.memoryEnabled ?? true, items: await this.items(caller.account.id) };
  }

  async setEnabled(caller: Caller, enabled: boolean) {
    this.requireWeb(caller);
    await this.prisma.account.update({ where: { id: caller.account.id }, data: { memoryEnabled: enabled } });
    return this.list(caller);
  }

  private clean(content: string) {
    const text = content.replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_CHARS);
    if (!text) throw new BadRequestException("Isi memori kosong.");
    if (isSensitive(text))
      throw new BadRequestException("Jangan simpan kata sandi, PIN, token, atau nomor identitas/rekening di memori.");
    return text;
  }

  async add(caller: Caller, content: string) {
    this.requireWeb(caller);
    const count = await this.prisma.memory.count({ where: { accountId: caller.account.id } });
    if (count >= MEMORY_MAX_ITEMS)
      throw new BadRequestException(`Maks. ${MEMORY_MAX_ITEMS} memori. Hapus yang tidak perlu.`);
    return this.prisma.memory.create({
      data: { accountId: caller.account.id, content: this.clean(content), source: "manual" },
    });
  }

  async update(caller: Caller, id: string, content: string) {
    this.requireWeb(caller);
    const done = await this.prisma.memory.updateMany({
      where: { id, accountId: caller.account.id },
      data: { content: this.clean(content), source: "manual" },
    });
    if (!done.count) throw new NotFoundException("Memori tidak ditemukan.");
    return this.prisma.memory.findUnique({ where: { id } });
  }

  async remove(caller: Caller, id: string) {
    this.requireWeb(caller);
    const done = await this.prisma.memory.deleteMany({ where: { id, accountId: caller.account.id } });
    if (!done.count) throw new NotFoundException("Memori tidak ditemukan.");
  }

  async clear(caller: Caller) {
    this.requireWeb(caller);
    await this.prisma.memory.deleteMany({ where: { accountId: caller.account.id } });
  }

  /** Blok memori untuk prompt sistem (null = memori mati / kosong). */
  async promptBlock(accountId: string): Promise<string | null> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { memoryEnabled: true } });
    if (!account?.memoryEnabled) return null;
    return memoryBlock(await this.items(accountId));
  }

  /**
   * Catat memori dari satu pertukaran (dijalankan di latar belakang setelah jawaban tersimpan). Perubahan ditulis ke memori dan ke
   * pesan asisten (`memory_updates`, ditampilkan "Memori diperbarui"). Galat = diabaikan (dicatat di log).
   */
  async learn(caller: Caller, conversationId: string, messageId: string, user: string, assistant: string) {
    try {
      const account = await this.prisma.account.findUnique({
        where: { id: caller.account.id },
        select: { memoryEnabled: true },
      });
      if (!account?.memoryEnabled || !worthExtracting(user) || !assistant.trim()) return;
      const existing = await this.items(caller.account.id);
      const body = {
        max_tokens: 400,
        messages: [{ role: "user", content: extractionPrompt(existing, user, assistant) }],
      };
      let json: Record<string, unknown>;
      try {
        json = await this.gateway.completion(caller, { ...body, task: "memory" });
      } catch (error) {
        // Tugas Memori belum diatur di Akai → pakai tugas Umum
        if (!(error instanceof HttpException) || !/Belum ada model/.test(JSON.stringify(error.getResponse())))
          throw error;
        json = await this.gateway.completion(caller, { ...body, task: "general" });
      }
      const choice = (json.choices as { message?: { content?: unknown } }[] | undefined)?.[0];
      const { add, remove } = parseExtraction(
        typeof choice?.message?.content === "string" ? choice.message.content : null,
        existing,
      );
      if (!add.length && !remove.length) return;
      const removed = existing.filter((m) => remove.includes(m.id));
      const room = MEMORY_MAX_ITEMS - (existing.length - removed.length);
      const added = add.slice(0, Math.max(0, room));
      await this.prisma.$transaction([
        this.prisma.memory.deleteMany({ where: { id: { in: remove }, accountId: caller.account.id } }),
        ...added.map((content) =>
          this.prisma.memory.create({
            data: { accountId: caller.account.id, content, source: "auto", conversationId },
          }),
        ),
      ]);
      const updates: MemoryUpdate[] = [
        ...added.map((content) => ({ op: "add" as const, content })),
        ...removed.map((m) => ({ op: "remove" as const, content: m.content })),
      ];
      await this.prisma.chatMessage.update({ where: { id: messageId }, data: { memoryUpdates: updates } });
    } catch (error) {
      this.logger.warn(`Pencatatan memori gagal: ${String(error)}`);
    }
  }
}
