import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { accessState, type AccessState } from "./access-state";

const CACHE_MS = 30_000;
const CACHE_MAX = 5_000;

/** Status masa akses per user (dibaca dari kolom yang diisi saat masuk / refresh SSO), dengan cache singkat. */
@Injectable()
export class AccessStateService {
  private readonly cache = new Map<string, { at: number; state: AccessState }>();

  constructor(private readonly prisma: PrismaService) {}

  async state(userId: string): Promise<AccessState> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accessExpiresAt: true, accessDeleteAt: true },
    });
    const state = user ? accessState(user.accessExpiresAt, user.accessDeleteAt) : "active";
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(userId, { at: Date.now(), state });
    return state;
  }

  /** Akun hanya boleh membaca (masa akses habis / berakhir)? Dipakai penjaga tulis & pekerjaan latar belakang. */
  async isReadOnly(userId: string) {
    return (await this.state(userId)) !== "active";
  }

  forget(userId: string) {
    this.cache.delete(userId);
  }
}
