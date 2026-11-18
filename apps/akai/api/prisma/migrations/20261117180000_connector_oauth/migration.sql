-- AlterTable
ALTER TABLE "connectors" ADD COLUMN     "auth_type" TEXT NOT NULL DEFAULT 'token',
ADD COLUMN     "oauth_client_id" TEXT,
ADD COLUMN     "oauth_client_secret_enc" TEXT,
ADD COLUMN     "oauth_enc" TEXT,
ADD COLUMN     "oauth_scope" TEXT,
ADD COLUMN     "oauth_state" TEXT,
ADD COLUMN     "preset" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "connectors_oauth_state_key" ON "connectors"("oauth_state");


-- Konektor lama tanpa token (server MCP publik) = tanpa login
UPDATE "connectors" SET "auth_type" = 'none' WHERE "kind" = 'custom' AND "token_enc" IS NULL AND "plugin_id" IS NULL;
