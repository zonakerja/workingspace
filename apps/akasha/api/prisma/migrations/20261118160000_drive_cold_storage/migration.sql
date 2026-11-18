-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "last_accessed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cold_storage" JSONB;

-- CreateTable
CREATE TABLE "cold_objects" (
    "id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "moved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cold_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cold_objects_object_key_key" ON "cold_objects"("object_key");

-- CreateIndex
CREATE INDEX "cold_objects_user_id_idx" ON "cold_objects"("user_id");

-- CreateIndex
CREATE INDEX "cold_objects_oauth_account_id_idx" ON "cold_objects"("oauth_account_id");

-- AddForeignKey
ALTER TABLE "cold_objects" ADD CONSTRAINT "cold_objects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cold_objects" ADD CONSTRAINT "cold_objects_oauth_account_id_fkey" FOREIGN KEY ("oauth_account_id") REFERENCES "oauth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

