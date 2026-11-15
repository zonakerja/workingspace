-- CreateTable
CREATE TABLE "mcp_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "preset" TEXT,
    "icon" TEXT,
    "auth_type" TEXT NOT NULL,
    "token_enc" TEXT,
    "oauth_enc" TEXT,
    "oauth_state" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "status_message" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "agent_enabled" BOOLEAN NOT NULL DEFAULT false,
    "allow_write" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_connections_oauth_state_key" ON "mcp_connections"("oauth_state");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_connections_user_id_slug_key" ON "mcp_connections"("user_id", "slug");

-- AddForeignKey
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

