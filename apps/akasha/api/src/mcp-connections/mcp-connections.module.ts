import { Module } from "@nestjs/common";
import { McpConnectionsController } from "./mcp-connections.controller";
import { McpConnectionsService } from "./mcp-connections.service";

/** Koneksi aplikasi MCP luar (LifeOS sebagai klien MCP). */
@Module({
  controllers: [McpConnectionsController],
  providers: [McpConnectionsService],
  exports: [McpConnectionsService],
})
export class McpConnectionsModule {}
