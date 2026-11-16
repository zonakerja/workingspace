-- CreateTable
CREATE TABLE "app_session_links" (
    "id" TEXT NOT NULL,
    "auth_session_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_session_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_session_links_account_id_idx" ON "app_session_links"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_session_links_auth_session_id_client_id_key" ON "app_session_links"("auth_session_id", "client_id");

-- AddForeignKey
ALTER TABLE "app_session_links" ADD CONSTRAINT "app_session_links_auth_session_id_fkey" FOREIGN KEY ("auth_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

