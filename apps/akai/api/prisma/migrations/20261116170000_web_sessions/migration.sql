-- CreateTable
CREATE TABLE "web_sessions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "sso_sid" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_sessions_token_hash_key" ON "web_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "web_sessions_account_id_idx" ON "web_sessions"("account_id");

-- CreateIndex
CREATE INDEX "web_sessions_sso_sid_idx" ON "web_sessions"("sso_sid");

-- AddForeignKey
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

