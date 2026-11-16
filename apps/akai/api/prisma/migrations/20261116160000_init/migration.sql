-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "source_kind" AS ENUM ('gemini', 'anthropic', 'openai', 'router');

-- CreateEnum
CREATE TYPE "api_format" AS ENUM ('openai', 'anthropic');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "sso_subject" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sources" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "source_kind" NOT NULL,
    "preset" TEXT,
    "label" TEXT NOT NULL,
    "base_url" TEXT,
    "api_format" "api_format" NOT NULL DEFAULT 'openai',
    "key_enc" TEXT NOT NULL,
    "key_hint" TEXT NOT NULL,
    "last_status" TEXT,
    "last_error" TEXT,
    "tested_at" TIMESTAMPTZ(3),
    "catalog_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_catalog" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context_length" INTEGER,
    "price_in" DOUBLE PRECISION,
    "price_out" DOUBLE PRECISION,
    "currency" TEXT,
    "vision" BOOLEAN NOT NULL DEFAULT false,
    "tools" BOOLEAN NOT NULL DEFAULT false,
    "embedding" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "context_length" INTEGER,
    "price_in" DOUBLE PRECISION,
    "price_out" DOUBLE PRECISION,
    "currency" TEXT,
    "packaged" BOOLEAN NOT NULL DEFAULT false,
    "vision" BOOLEAN NOT NULL DEFAULT false,
    "pdf" BOOLEAN NOT NULL DEFAULT false,
    "tools" BOOLEAN NOT NULL DEFAULT false,
    "embedding" BOOLEAN NOT NULL DEFAULT false,
    "audio" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_routes" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model_ids" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_task_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "task" TEXT,
    "model_id" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "cost" DOUBLE PRECISION,
    "currency" TEXT,
    "duration_ms" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "fallback_from" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_sso_subject_key" ON "accounts"("sso_subject");

-- CreateIndex
CREATE INDEX "ai_sources_account_id_idx" ON "ai_sources"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_catalog_source_id_model_id_key" ON "ai_catalog"("source_id", "model_id");

-- CreateIndex
CREATE INDEX "ai_models_account_id_idx" ON "ai_models"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_source_id_model_id_key" ON "ai_models"("source_id", "model_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_routes_account_id_task_key" ON "ai_task_routes"("account_id", "task");

-- CreateIndex
CREATE INDEX "ai_usage_account_id_created_at_idx" ON "ai_usage"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_catalog" ADD CONSTRAINT "ai_catalog_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ai_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ai_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

