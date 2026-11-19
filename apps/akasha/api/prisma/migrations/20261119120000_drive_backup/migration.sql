-- AlterTable
ALTER TABLE "users" ADD COLUMN     "drive_backup" JSONB;

-- CreateTable
CREATE TABLE "drive_backups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "folder_id" TEXT,
    "stats" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "drive_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_backup_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_account_id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_backup_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drive_backups_user_id_started_at_idx" ON "drive_backups"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "drive_backup_files_user_id_idx" ON "drive_backup_files"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_backup_files_oauth_account_id_checksum_key" ON "drive_backup_files"("oauth_account_id", "checksum");

-- AddForeignKey
ALTER TABLE "drive_backups" ADD CONSTRAINT "drive_backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_backup_files" ADD CONSTRAINT "drive_backup_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

