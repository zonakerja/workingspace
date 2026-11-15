-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "email_token_kind" AS ENUM ('verify', 'reset');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "super_admin" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" TEXT,
    "pin_failed" INTEGER NOT NULL DEFAULT 0,
    "pin_blocked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_identities" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apps" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "self_signup" "app_role",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app_memberships" (
    "account_id" TEXT NOT NULL,
    "app_key" TEXT NOT NULL,
    "role" "app_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_memberships_pkey" PRIMARY KEY ("account_id","app_key")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "email_token_kind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_payloads" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" TEXT,
    "user_code" TEXT,
    "uid" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "oidc_payloads_pkey" PRIMARY KEY ("type","id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT,
    "event" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "account_identities_account_id_idx" ON "account_identities"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_identities_provider_subject_key" ON "account_identities"("provider", "subject");

-- CreateIndex
CREATE INDEX "app_memberships_app_key_idx" ON "app_memberships"("app_key");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_account_id_kind_idx" ON "email_tokens"("account_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_account_id_idx" ON "auth_sessions"("account_id");

-- CreateIndex
CREATE INDEX "oidc_payloads_grant_id_idx" ON "oidc_payloads"("grant_id");

-- CreateIndex
CREATE INDEX "oidc_payloads_uid_idx" ON "oidc_payloads"("uid");

-- CreateIndex
CREATE INDEX "oidc_payloads_expires_at_idx" ON "oidc_payloads"("expires_at");

-- CreateIndex
CREATE INDEX "security_events_account_id_created_at_idx" ON "security_events"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_app_key_fkey" FOREIGN KEY ("app_key") REFERENCES "apps"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

