-- AlterTable
ALTER TABLE "pos_governance_rules" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_supervisor_overrides" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "pos_supervisor_overrides_companyId_branchId_status_createdAt_id" RENAME TO "pos_supervisor_overrides_companyId_branchId_status_createdA_idx";
