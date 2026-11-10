-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "children" JSONB,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_actions_user_id_created_at_idx" ON "agent_actions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_user_id_status_idx" ON "agent_actions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

