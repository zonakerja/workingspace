import { Module } from "@nestjs/common";
import { AgentMenusService } from "./agent-menus.service";

/** Modul terpisah karena dipakai dua arah: alat MCP (integrasi) dan endpoint Asisten Agen. */
@Module({
  providers: [AgentMenusService],
  exports: [AgentMenusService],
})
export class AgentMenusModule {}
