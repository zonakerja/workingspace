-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "conversation_id" TEXT;

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_conversations_user_id_updated_at_idx" ON "agent_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_created_at_idx" ON "agent_runs"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

