-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sso_subject" TEXT,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_sso_subject_key" ON "users"("sso_subject");

