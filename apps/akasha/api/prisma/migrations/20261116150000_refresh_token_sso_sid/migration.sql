-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "sso_sid" TEXT;

-- CreateIndex
CREATE INDEX "refresh_tokens_sso_sid_idx" ON "refresh_tokens"("sso_sid");

