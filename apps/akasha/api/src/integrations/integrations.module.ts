import { Module } from "@nestjs/common";
import { AgentActionsModule } from "../agent-actions/agent-actions.module";
import { AgentMenusModule } from "../agent-menus/agent-menus.module";
import { AiModule } from "../ai/ai.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { McpConnectionsModule } from "../mcp-connections/mcp-connections.module";
import { RecordsModule } from "../records/records.module";
import { RequestsModule } from "../requests/requests.module";
import { RobotModule } from "../robot/robot.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { ApiTokensService } from "./api-tokens.service";
import { IntegrationsController, McpController } from "./integrations.controller";
import { LifeosMcpService } from "./lifeos-mcp.service";

/** Integrasi agen: token akses pribadi + MCP server LifeOS (docs/AI-AGENT.md tahap 3). */
@Module({
  imports: [
    AgentActionsModule,
    AgentMenusModule,
    AiModule,
    KnowledgeModule,
    McpConnectionsModule,
    RecordsModule,
    RequestsModule,
    RobotModule,
    WhatsappModule,
  ],
  controllers: [IntegrationsController, McpController],
  providers: [ApiTokensService, LifeosMcpService],
  exports: [ApiTokensService],
})
export class IntegrationsModule {}
