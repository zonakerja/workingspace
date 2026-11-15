-- CreateTable
CREATE TABLE "srikandi_inboxes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" TEXT,
    "date" DATE,
    "sent_date" DATE,
    "number" TEXT,
    "subject" TEXT,
    "origin" TEXT,
    "read_status" TEXT,
    "follow_up_status" TEXT,
    "synced_at" TIMESTAMPTZ(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "srikandi_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "srikandi_inboxes_user_id_deleted_at_idx" ON "srikandi_inboxes"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "srikandi_inboxes_user_id_kind_idx" ON "srikandi_inboxes"("user_id", "kind");

-- CreateIndex
CREATE INDEX "srikandi_inboxes_user_id_date_idx" ON "srikandi_inboxes"("user_id", "date");

-- CreateIndex
CREATE INDEX "srikandi_inboxes_user_id_number_idx" ON "srikandi_inboxes"("user_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "srikandi_inboxes_user_id_client_id_key" ON "srikandi_inboxes"("user_id", "client_id");

-- AddForeignKey
ALTER TABLE "srikandi_inboxes" ADD CONSTRAINT "srikandi_inboxes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

