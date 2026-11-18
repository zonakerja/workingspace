import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { SsoService } from "../auth/sso.service";
import { AccessStateService } from "../access/access-state.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

const ROUND_MS = 6 * 60 * 60 * 1000;
const FIRST_ROUND_MS = 5 * 60 * 1000;

/**
 * Akun yang masa bekunya (180 hari setelah akses habis) sudah lewat → data Akasha dihapus permanen. Sebelum menghapus,
 * status dipastikan ulang ke SSO (admin mungkin sudah memperpanjang): hanya dihapus bila SSO menjawab akses `ended`.
 * SSO tidak terjangkau / akun tidak ada di SSO = tidak dihapus (bukan masa akses yang menentukan).
 */
@Injectable()
export class AccessCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessCleanupService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly sso: SsoService,
    private readonly users: UsersService,
    private readonly access: AccessStateService,
  ) {}

  onModuleInit() {
    const tick = () => void this.run().catch((e) => this.logger.warn(`Pembersihan masa akses gagal: ${String(e)}`));
    this.timers.push(setTimeout(tick, FIRST_ROUND_MS), setInterval(tick, ROUND_MS));
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  async run(now = new Date()) {
    if (!this.sso.enabled) return 0;
    const due = await this.prisma.user.findMany({
      where: { ssoSubject: { not: null }, accessDeleteAt: { lte: now } },
      select: { id: true, email: true, ssoSubject: true },
    });
    let removed = 0;
    for (const user of due) {
      const status = await this.sso.accountStatus(user.ssoSubject!, true);
      if (status === null || status === "missing") continue;
      if (status.access?.state !== "ended") {
        // Diperpanjang / diubah di SSO → simpan tanggal terbaru, tidak dihapus
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            accessExpiresAt: status.access?.expiresAt ? new Date(status.access.expiresAt) : null,
            accessDeleteAt: status.access?.deleteAt ? new Date(status.access.deleteAt) : null,
          },
        });
        this.access.forget(user.id);
        continue;
      }
      await this.users.purge(user.id);
      this.access.forget(user.id);
      this.logger.log(`Data akun ${user.email} dihapus: masa beku 180 hari setelah akses berakhir sudah lewat.`);
      removed++;
    }
    return removed;
  }
}
