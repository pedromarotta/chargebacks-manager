-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dispute" (
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
    "filing_rejected_at" DATETIME,
    "filing_reject_reason" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'US',
    "funds_status" TEXT,
    "funds_received_at" DATETIME,
    "funds_settled_at" DATETIME,
    "funds_pending_move" TEXT,
    "funds_proposed_by" TEXT,
    "funds_proposal_note" TEXT,
    "funds_decided_by" TEXT,
    "p_win_pct" INTEGER,
    "expected_value_cents" INTEGER,
    "recommendation" TEXT,
    "merchant_type" TEXT,
    "pre_arb_memo" TEXT,
    "network_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_Dispute" ("amount_cents", "card_last4", "client", "created_at", "currency", "decided_at", "decided_by", "decision_note", "decision_type", "due_at", "expected_value_cents", "filing_reject_reason", "filing_rejected_at", "id", "merchant", "merchant_response", "merchant_type", "network_ref", "opened_at", "p_win_pct", "pre_arb_memo", "proposal_note", "proposed_by", "provisional_credit_cents", "reason_code", "recommendation", "representment_received_at", "status", "updated_at") SELECT "amount_cents", "card_last4", "client", "created_at", "currency", "decided_at", "decided_by", "decision_note", "decision_type", "due_at", "expected_value_cents", "filing_reject_reason", "filing_rejected_at", "id", "merchant", "merchant_response", "merchant_type", "network_ref", "opened_at", "p_win_pct", "pre_arb_memo", "proposal_note", "proposed_by", "provisional_credit_cents", "reason_code", "recommendation", "representment_received_at", "status", "updated_at" FROM "Dispute";
DROP TABLE "Dispute";
ALTER TABLE "new_Dispute" RENAME TO "Dispute";
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");
CREATE INDEX "Dispute_due_at_idx" ON "Dispute"("due_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
