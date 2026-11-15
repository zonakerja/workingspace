-- AlterTable
ALTER TABLE "notebooks" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "pin_unlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "session_id" TEXT;
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pin_blocked_until" TIMESTAMPTZ(3),
ADD COLUMN     "pin_failed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_hash" TEXT;
-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- Sesi lama: pengenal sesi = id token agar status PIN bisa ditempelkan
UPDATE "refresh_tokens" SET "session_id" = "id" WHERE "session_id" IS NULL;
