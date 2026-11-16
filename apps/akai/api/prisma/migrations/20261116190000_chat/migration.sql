-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Percakapan baru',
    "model_id" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB,
    "model" TEXT,
    "fallback_from" TEXT,
    "error" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_account_id_updated_at_idx" ON "conversations"("account_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_attachments_account_id_created_at_idx" ON "chat_attachments"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_attachments_conversation_id_idx" ON "chat_attachments"("conversation_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

