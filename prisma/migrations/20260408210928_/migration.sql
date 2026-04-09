-- AlterTable
ALTER TABLE "accounting_bank_accounts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting_bank_movements" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting_deferred_charges" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting_fixed_assets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting_provision_templates" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting_tax_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_entry_approval_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_entry_attachments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_combos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_loyalty_campaigns" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_post_sale_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_price_lists" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pos_promotions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "accounting_deferred_charge_runs_companyId_periodYear_periodMont" RENAME TO "accounting_deferred_charge_runs_companyId_periodYear_period_idx";

-- RenameIndex
ALTER INDEX "accounting_deferred_charge_runs_deferredChargeId_periodYear_per" RENAME TO "accounting_deferred_charge_runs_deferredChargeId_periodYear_key";

-- RenameIndex
ALTER INDEX "accounting_fixed_asset_runs_companyId_periodYear_periodMonth_id" RENAME TO "accounting_fixed_asset_runs_companyId_periodYear_periodMont_idx";

-- RenameIndex
ALTER INDEX "accounting_provision_templates_companyId_isActive_nextRunDate_i" RENAME TO "accounting_provision_templates_companyId_isActive_nextRunDa_idx";
