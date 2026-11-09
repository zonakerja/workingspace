-- AlterTable
ALTER TABLE "agent_policies" ADD COLUMN     "verify_assets" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "menu_id" TEXT;

-- CreateTable
CREATE TABLE "agent_menus" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'bot',
    "skill" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_menus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_menus_user_id_slug_key" ON "agent_menus"("user_id", "slug");

-- CreateIndex
CREATE INDEX "agent_runs_menu_id_idx" ON "agent_runs"("menu_id");

-- AddForeignKey
ALTER TABLE "agent_menus" ADD CONSTRAINT "agent_menus_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

