-- CreateEnum
CREATE TYPE "access_request_status" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "app_memberships" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "expiry_notice" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "app_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "access_request_status" NOT NULL DEFAULT 'pending',
    "role" "app_role",
    "duration_days" INTEGER,
    "note" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_status_created_at_idx" ON "access_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "access_requests_account_id_idx" ON "access_requests"("account_id");

-- CreateIndex
CREATE INDEX "app_memberships_expires_at_idx" ON "app_memberships"("expires_at");

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_app_key_fkey" FOREIGN KEY ("app_key") REFERENCES "apps"("key") ON DELETE CASCADE ON UPDATE CASCADE;

