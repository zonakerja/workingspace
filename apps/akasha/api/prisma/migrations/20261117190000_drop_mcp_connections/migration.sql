-- DropForeignKey
ALTER TABLE "mcp_connections" DROP CONSTRAINT "mcp_connections_user_id_fkey";

-- DropTable
DROP TABLE "mcp_connections";


-- Sisa fitur Aplikasi MCP (dihapus 2026-11-17; aplikasi luar kini disambungkan di Akai → Konektor)
DELETE FROM "agent_actions" WHERE "kind" IN ('mcp_connect', 'mcp_access');
UPDATE "agent_menus" SET "placement" = 'workflow' WHERE "placement" = 'mcp';
UPDATE "api_tokens" SET "scopes" = "scopes" - 'mcp:apps' WHERE "scopes" ? 'mcp:apps';
