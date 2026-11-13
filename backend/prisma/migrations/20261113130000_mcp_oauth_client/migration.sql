-- AlterTable
ALTER TABLE "mcp_connections" ADD COLUMN     "oauth_client_id" TEXT,
ADD COLUMN     "oauth_client_secret_enc" TEXT,
ADD COLUMN     "oauth_scope" TEXT;

