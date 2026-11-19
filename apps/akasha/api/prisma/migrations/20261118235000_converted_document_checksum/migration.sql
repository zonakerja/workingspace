-- AlterTable
ALTER TABLE "converted_documents" ADD COLUMN     "checksum" TEXT;

-- CreateIndex
CREATE INDEX "converted_documents_user_id_checksum_idx" ON "converted_documents"("user_id", "checksum");

