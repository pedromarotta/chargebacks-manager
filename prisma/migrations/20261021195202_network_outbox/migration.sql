-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotency_key" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "network_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_idempotency_key_key" ON "OutboxMessage"("idempotency_key");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_idx" ON "OutboxMessage"("status");
