-- CreateTable
CREATE TABLE "trash_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "record_type" TEXT,
    "item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "snapshot" JSONB,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trash_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trash_items_user_id_deleted_at_idx" ON "trash_items"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trash_items_user_id_kind_item_id_idx" ON "trash_items"("user_id", "kind", "item_id");

-- CreateIndex
CREATE INDEX "trash_items_expires_at_idx" ON "trash_items"("expires_at");

-- AddForeignKey
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

