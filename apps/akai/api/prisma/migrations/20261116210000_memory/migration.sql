-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "memory_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "memory_updates" JSONB;

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "conversation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_account_id_created_at_idx" ON "memories"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

