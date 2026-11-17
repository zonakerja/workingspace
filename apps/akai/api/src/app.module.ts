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
import { AgentModelService } from "./gateway/agent-model.service";
import { ChatController } from "./chat/chat.controller";
import { ChatService } from "./chat/chat.service";
import { ConnectorsController } from "./connectors/connectors.controller";
import { ConnectorsService } from "./connectors/connectors.service";
import { MemoryController } from "./memory/memory.controller";
import { MemoryService } from "./memory/memory.service";
import { MailService } from "./schedules/mail.service";
import { SchedulesController } from "./schedules/schedules.controller";
import { SchedulesService } from "./schedules/schedules.service";
import { PluginsController } from "./plugins/plugins.controller";
import { PluginsService } from "./plugins/plugins.service";
import { SkillsController } from "./skills/skills.controller";
import { SkillsService } from "./skills/skills.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
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
  controllers: [
    HealthController,
    AuthController,
    SourcesController,
    UsageController,
    GatewayController,
    ChatController,
    ProjectsController,
    MemoryController,
    ConnectorsController,
    SkillsController,
    PluginsController,
    SchedulesController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    SsoService,
    WebSessionsService,
    CallerService,
    SourcesService,
    GatewayService,
    AgentModelService,
    ChatService,
    ProjectsService,
    MemoryService,
    ConnectorsService,
    SkillsService,
    PluginsService,
    MailService,
    SchedulesService,
  ],
})
export class AppModule {}
