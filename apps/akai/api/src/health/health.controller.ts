import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

@SkipThrottle()
@Controller("api/health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Readiness: 503 bila database tidak terjangkau. */
  @Get()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: "error", checks: { database: "down" } });
    }
    return {
      status: "ok",
      service: "akai",
      checks: { database: "up" },
      timestamp: new Date().toISOString(),
    };
  }

  @Get("live")
  live() {
    return { status: "ok" };
  }
}
