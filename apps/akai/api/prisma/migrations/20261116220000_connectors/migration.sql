-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "tool_runs" JSONB;

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "url" TEXT,
    "token_enc" TEXT,
    "token_hint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allow_write" BOOLEAN NOT NULL DEFAULT false,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'new',
    "status_message" TEXT,
    "checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connectors_account_id_slug_key" ON "connectors"("account_id", "slug");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

