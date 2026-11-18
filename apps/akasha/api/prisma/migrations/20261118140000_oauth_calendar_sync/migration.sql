-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "inbox_cursor" TEXT,
ADD COLUMN     "oauth_account_id" TEXT;

-- AlterTable
ALTER TABLE "mail_messages" ADD COLUMN     "external_id" TEXT,
ALTER COLUMN "uid" DROP NOT NULL,
ALTER COLUMN "uid_validity" DROP NOT NULL;

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "scopes" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "status_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_account_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "calendar_name" TEXT NOT NULL,
    "sync_state" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "status_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_links" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "etag" TEXT,
    "local_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_user_id_provider_email_key" ON "oauth_accounts"("user_id", "provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_oauth_account_id_key" ON "calendar_connections"("oauth_account_id");

-- CreateIndex
CREATE INDEX "calendar_connections_enabled_idx" ON "calendar_connections"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_connection_id_schedule_id_key" ON "calendar_event_links"("connection_id", "schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_connection_id_external_id_key" ON "calendar_event_links"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_account_id_external_id_key" ON "mail_messages"("account_id", "external_id");

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_oauth_account_id_fkey" FOREIGN KEY ("oauth_account_id") REFERENCES "oauth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_oauth_account_id_fkey" FOREIGN KEY ("oauth_account_id") REFERENCES "oauth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

