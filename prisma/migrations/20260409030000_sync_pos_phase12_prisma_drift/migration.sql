-- AlterTable
ALTER TABLE "pos_coupons" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_external_orders" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "pos_sessions_offlineSinceAt_idx" ON "pos_sessions"("offlineSinceAt");

-- RenameIndex
ALTER INDEX "pos_bank_reconciliation_batches_companyId_branchId_createdAt_id" RENAME TO "pos_bank_reconciliation_batches_companyId_branchId_createdA_idx";
