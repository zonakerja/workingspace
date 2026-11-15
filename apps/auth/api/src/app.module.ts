import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AccountsController } from "./accounts/accounts.controller";
import { AdminController } from "./admin/admin.controller";
import { ClientApiController } from "./admin/client-api.controller";
import { ClientAuthService } from "./common/client-auth";
import { AccountsService } from "./accounts/accounts.service";
import { SessionsService } from "./accounts/sessions.service";
import { validateEnv } from "./config/env.validation";
import { loggerConfig } from "./config/logger.config";
import { HealthController } from "./health/health.controller";
import { MailService } from "./mail/mail.service";
import { InteractionController } from "./oidc/interaction.controller";
import { OidcService } from "./oidc/oidc.service";
import { PinController } from "./pin/pin.controller";
import { PinService } from "./pin/pin.service";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: loggerConfig }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
  ],
  controllers: [
    HealthController,
    AccountsController,
    AdminController,
    ClientApiController,
    PinController,
    InteractionController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    MailService,
    AccountsService,
    SessionsService,
    OidcService,
    PinService,
    ClientAuthService,
  ],
})
export class AppModule {}
