-- DropForeignKey
ALTER TABLE "ai_credentials" DROP CONSTRAINT "ai_credentials_user_id_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "ai_fallback",
DROP COLUMN "ai_provider",
DROP COLUMN "ai_routing";

-- DropTable
DROP TABLE "ai_credentials";

-- DropEnum
DROP TYPE "ai_provider";

