-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "scheduled_task_id" TEXT,
ADD COLUMN     "unread" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "code" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "config_enc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allow_write" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "model_id" TEXT,
    "project_id" TEXT,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugins_account_id_name_key" ON "plugins"("account_id", "name");

-- CreateIndex
CREATE INDEX "scheduled_tasks_enabled_next_run_at_idx" ON "scheduled_tasks"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "conversations_scheduled_task_id_idx" ON "conversations"("scheduled_task_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_scheduled_task_id_fkey" FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

