-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN "expected_value_cents" INTEGER;
ALTER TABLE "Dispute" ADD COLUMN "p_win_pct" INTEGER;
ALTER TABLE "Dispute" ADD COLUMN "recommendation" TEXT;
