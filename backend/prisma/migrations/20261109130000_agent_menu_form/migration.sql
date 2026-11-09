-- AlterTable
ALTER TABLE "agent_menus" ADD COLUMN     "form" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "placement" TEXT NOT NULL DEFAULT 'workflow';

