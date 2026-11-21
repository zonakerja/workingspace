
-- CreateTable
CREATE TABLE "siman_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "ticket" TEXT,
    "status" TEXT,
    "tipe" TEXT,
    "date" DATE,
    "satker_code" TEXT,
    "satker_name" TEXT,
    "value" DOUBLE PRECISION,
    "disposed" BOOLEAN,
    "active" BOOLEAN,
    "synced_at" TIMESTAMPTZ(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "siman_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "siman_requests_user_id_deleted_at_idx" ON "siman_requests"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "siman_requests_user_id_ticket_idx" ON "siman_requests"("user_id", "ticket");

-- CreateIndex
CREATE INDEX "siman_requests_user_id_disposed_idx" ON "siman_requests"("user_id", "disposed");

-- CreateIndex
CREATE INDEX "siman_requests_user_id_date_idx" ON "siman_requests"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "siman_requests_user_id_client_id_key" ON "siman_requests"("user_id", "client_id");

-- AddForeignKey
ALTER TABLE "siman_requests" ADD CONSTRAINT "siman_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

