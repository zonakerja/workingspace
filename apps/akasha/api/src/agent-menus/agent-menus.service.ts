import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isAgentOwner } from "../agent/agent-logic";
import type { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_MENUS_PER_USER, type MenuProposal, type MenuStatus, normalizeMenuProposal } from "./agent-menu-logic";
import type { Prisma } from "../generated/prisma/client";

/**
 * Fitur non-native buatan agen. Agen hanya bisa mengusulkan (status draf); pemilik yang menyetujui di Approval. Agen yang
 * mengubah fitur aktif mengembalikannya ke draf, sehingga isi yang berubah selalu diperiksa pemilik lebih dulu. Agen tidak
 * punya jalur menghapus, dan fitur native tidak tersimpan di sini sehingga tidak bisa disentuh.
 */
@Injectable()
export class AgentMenusService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private isOwner(user: AuthUser) {
    return isAgentOwner(this.config.get<string>("HERMES_OWNER_EMAIL"), user.email);
  }

  /** Bukan pemilik agen = daftar kosong, karena sidebar memanggil ini untuk semua akun. */
  list(user: AuthUser) {
    if (!this.isOwner(user)) return Promise.resolve([]);
    return this.forUser(user.id);
  }

  forUser(userId: string) {
    return this.prisma.agentMenu.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  }

  /** Dipanggil alat MCP `propose_agent_menu`: buat draf baru atau perbarui menu ber-slug sama (kembali ke draf). */
  async propose(userId: string, input: MenuProposal) {
    const menu = normalizeMenuProposal(input);
    if ("error" in menu) throw new UnprocessableEntityException(menu.error);
    const existing = await this.prisma.agentMenu.findUnique({ where: { userId_slug: { userId, slug: menu.slug } } });
    if (existing)
      return this.prisma.agentMenu.update({
        where: { id: existing.id },
        data: { ...menu, form: menu.form as unknown as Prisma.InputJsonValue, status: "draft" },
      });
    if ((await this.prisma.agentMenu.count({ where: { userId } })) >= MAX_MENUS_PER_USER) {
      throw new UnprocessableEntityException(
        `Sudah ada ${MAX_MENUS_PER_USER} fitur buatan agen. Minta pemilik menghapus yang tidak dipakai.`,
      );
    }
    return this.prisma.agentMenu.create({
      data: { ...menu, form: menu.form as unknown as Prisma.InputJsonValue, userId, status: "draft" },
    });
  }

  async get(userId: string, id: string) {
    const menu = await this.prisma.agentMenu.findFirst({ where: { id, userId } });
    if (!menu) throw new NotFoundException("Menu tidak ditemukan.");
    return menu;
  }

  async setStatus(userId: string, id: string, status: MenuStatus) {
    await this.get(userId, id);
    return this.prisma.agentMenu.update({ where: { id }, data: { status } });
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.agentMenu.delete({ where: { id } });
    return { ok: true };
  }
}
