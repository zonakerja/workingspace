-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "pin_active_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pin_auto_lock_minutes" INTEGER;

