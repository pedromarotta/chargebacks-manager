-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client" TEXT NOT NULL,
    "card_last4" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "opened_at" DATETIME NOT NULL,
    "due_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "provisional_credit_cents" INTEGER NOT NULL,
    "representment_received_at" DATETIME,
    "merchant_response" TEXT,
    "decision_type" TEXT,
    "proposed_by" TEXT,
    "proposal_note" TEXT,
    "decided_by" TEXT,
    "decided_at" DATETIME,
    "decision_note" TEXT,
    "network_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dispute_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_by" TEXT,
    "checked_at" DATETIME,
    CONSTRAINT "EvidenceItem_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "Dispute" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetworkCall" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotency_key" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "network_ref" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetworkCall_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "Dispute" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "History" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "dispute_id" TEXT,
    "before" TEXT,
    "after" TEXT,
    "note" TEXT,
    CONSTRAINT "History_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "Dispute" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batch_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "case_id" TEXT,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    CONSTRAINT "ImportRow_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_due_at_idx" ON "Dispute"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_dispute_id_key_key" ON "EvidenceItem"("dispute_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkCall_idempotency_key_key" ON "NetworkCall"("idempotency_key");

-- CreateIndex
CREATE INDEX "History_dispute_id_idx" ON "History"("dispute_id");

-- CreateIndex
CREATE INDEX "History_at_idx" ON "History"("at");

-- History is append-only (R9).
CREATE TRIGGER "History_no_update" BEFORE UPDATE ON "History"
BEGIN
    SELECT RAISE(ABORT, 'History is append-only');
END;

CREATE TRIGGER "History_no_delete" BEFORE DELETE ON "History"
BEGIN
    SELECT RAISE(ABORT, 'History is append-only');
END;
