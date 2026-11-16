import { Controller, Get, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { CallerService } from "../common/caller";
import { PrismaService } from "../prisma/prisma.service";
import { summarizeUsage, usageDays } from "./usage-logic";

/** Ringkasan pemakaian & perkiraan biaya milik akun (`GET /api/usage?days=30`) + 50 panggilan terakhir. */
@Controller("api")
export class UsageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caller: CallerService,
  ) {}

  @Get("usage")
  async usage(@Query("days") rawDays: string | undefined, @Req() req: Request) {
    const accountId = (await this.caller.resolve(req)).account.id;
    const days = usageDays(rawDays);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { accountId, createdAt: { gte: since } };
    const [rows, recent, models] = await Promise.all([
      this.prisma.aiUsage.findMany({
        where,
        select: {
          modelId: true,
          task: true,
          clientId: true,
          ok: true,
          inputTokens: true,
          outputTokens: true,
          cost: true,
          currency: true,
        },
        take: 50_000,
      }),
      this.prisma.aiUsage.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.aiModel.findMany({ where: { accountId }, select: { id: true, label: true, modelId: true } }),
    ]);
    const labels = Object.fromEntries(models.map((m) => [m.id, m.label]));
    return { days, ...summarizeUsage(rows), recent: recent.map(({ accountId: _a, ...r }) => (void _a, r)), labels };
  }
}
