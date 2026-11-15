-- CreateTable
CREATE TABLE "converted_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "options" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "engine" TEXT,
    "markdown" TEXT,
    "enhanced_markdown" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "converted_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "converted_documents_user_id_created_at_idx" ON "converted_documents"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "converted_documents" ADD CONSTRAINT "converted_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

