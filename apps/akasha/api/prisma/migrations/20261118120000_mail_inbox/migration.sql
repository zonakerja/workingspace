-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "imap_host" TEXT,
ADD COLUMN     "imap_port" INTEGER,
ADD COLUMN     "inbox_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "inbox_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inbox_error" TEXT,
ADD COLUMN     "inbox_index" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inbox_last_uid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inbox_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "inbox_uid_validity" TEXT;

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "uid_validity" TEXT NOT NULL,
    "message_id" TEXT,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "to_text" TEXT,
    "subject" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "snippet" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "hints" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'new',
    "linked" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_messages_user_id_sent_at_idx" ON "mail_messages"("user_id", "sent_at");

-- CreateIndex
CREATE INDEX "mail_messages_user_id_status_idx" ON "mail_messages"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_account_id_uid_validity_uid_key" ON "mail_messages"("account_id", "uid_validity", "uid");

-- CreateIndex
CREATE INDEX "mail_accounts_inbox_enabled_idx" ON "mail_accounts"("inbox_enabled");

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

