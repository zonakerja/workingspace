import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AuthController } from "./auth/auth.controller";
import { SsoService } from "./auth/sso.service";
import { WebSessionsService } from "./auth/web-sessions.service";
import { CallerService } from "./common/caller";
import { validateEnv } from "./config/env.validation";
import { loggerConfig } from "./config/logger.config";
import { GatewayController } from "./gateway/gateway.controller";
import { GatewayService } from "./gateway/gateway.service";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { SourcesController } from "./sources/sources.controller";
import { SourcesService } from "./sources/sources.service";
import { UsageController } from "./usage/usage.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: loggerConfig }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
  ],
  controllers: [HealthController, AuthController, SourcesController, UsageController, GatewayController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    SsoService,
    WebSessionsService,
    CallerService,
    SourcesService,
    GatewayService,
  ],
})
export class AppModule {}
