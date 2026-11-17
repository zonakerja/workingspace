-- AlterTable
ALTER TABLE "connectors" ADD COLUMN     "plugin_id" TEXT;

-- AlterTable
ALTER TABLE "plugins" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'code';

-- CreateIndex
CREATE INDEX "connectors_plugin_id_idx" ON "connectors"("plugin_id");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
