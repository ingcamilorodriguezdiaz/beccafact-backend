CREATE TABLE "accounting_fixed_assets" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "acquisitionDate" TIMESTAMP(3) NOT NULL,
  "startDepreciationDate" TIMESTAMP(3) NOT NULL,
  "cost" DECIMAL(14,2) NOT NULL,
  "salvageValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "usefulLifeMonths" INTEGER NOT NULL,
  "assetAccountId" TEXT NOT NULL,
  "accumulatedDepAccountId" TEXT NOT NULL,
  "depreciationExpenseAccountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_fixed_asset_runs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "periodYear" INTEGER NOT NULL,
  "periodMonth" INTEGER NOT NULL,
  "runDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "entryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_fixed_asset_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_deferred_charges" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "chargeCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "termMonths" INTEGER NOT NULL,
  "assetAccountId" TEXT NOT NULL,
  "amortizationExpenseAccountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_deferred_charges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_deferred_charge_runs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "deferredChargeId" TEXT NOT NULL,
  "periodYear" INTEGER NOT NULL,
  "periodMonth" INTEGER NOT NULL,
  "runDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "entryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_deferred_charge_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_provision_templates" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provisionCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "frequencyMonths" INTEGER NOT NULL DEFAULT 1,
  "startDate" TIMESTAMP(3) NOT NULL,
  "nextRunDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "expenseAccountId" TEXT NOT NULL,
  "liabilityAccountId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_provision_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_provision_runs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "periodYear" INTEGER NOT NULL,
  "periodMonth" INTEGER NOT NULL,
  "runDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "entryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_provision_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_fixed_assets_companyId_assetCode_key" ON "accounting_fixed_assets"("companyId", "assetCode");
CREATE INDEX "accounting_fixed_assets_companyId_status_idx" ON "accounting_fixed_assets"("companyId", "status");
CREATE INDEX "accounting_fixed_assets_companyId_assetAccountId_idx" ON "accounting_fixed_assets"("companyId", "assetAccountId");

CREATE UNIQUE INDEX "accounting_fixed_asset_runs_assetId_periodYear_periodMonth_key" ON "accounting_fixed_asset_runs"("assetId", "periodYear", "periodMonth");
CREATE INDEX "accounting_fixed_asset_runs_companyId_periodYear_periodMonth_idx" ON "accounting_fixed_asset_runs"("companyId", "periodYear", "periodMonth");

CREATE UNIQUE INDEX "accounting_deferred_charges_companyId_chargeCode_key" ON "accounting_deferred_charges"("companyId", "chargeCode");
CREATE INDEX "accounting_deferred_charges_companyId_status_idx" ON "accounting_deferred_charges"("companyId", "status");

CREATE UNIQUE INDEX "accounting_deferred_charge_runs_deferredChargeId_periodYear_periodMonth_key" ON "accounting_deferred_charge_runs"("deferredChargeId", "periodYear", "periodMonth");
CREATE INDEX "accounting_deferred_charge_runs_companyId_periodYear_periodMonth_idx" ON "accounting_deferred_charge_runs"("companyId", "periodYear", "periodMonth");

CREATE UNIQUE INDEX "accounting_provision_templates_companyId_provisionCode_key" ON "accounting_provision_templates"("companyId", "provisionCode");
CREATE INDEX "accounting_provision_templates_companyId_isActive_nextRunDate_idx" ON "accounting_provision_templates"("companyId", "isActive", "nextRunDate");

CREATE UNIQUE INDEX "accounting_provision_runs_templateId_periodYear_periodMonth_key" ON "accounting_provision_runs"("templateId", "periodYear", "periodMonth");
CREATE INDEX "accounting_provision_runs_companyId_periodYear_periodMonth_idx" ON "accounting_provision_runs"("companyId", "periodYear", "periodMonth");

ALTER TABLE "accounting_fixed_assets"
  ADD CONSTRAINT "accounting_fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_fixed_assets_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_fixed_assets_accumulatedDepAccountId_fkey" FOREIGN KEY ("accumulatedDepAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_fixed_assets_depreciationExpenseAccountId_fkey" FOREIGN KEY ("depreciationExpenseAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_fixed_asset_runs"
  ADD CONSTRAINT "accounting_fixed_asset_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_fixed_asset_runs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "accounting_fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_deferred_charges"
  ADD CONSTRAINT "accounting_deferred_charges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_deferred_charges_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_deferred_charges_amortizationExpenseAccountId_fkey" FOREIGN KEY ("amortizationExpenseAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_deferred_charge_runs"
  ADD CONSTRAINT "accounting_deferred_charge_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_deferred_charge_runs_deferredChargeId_fkey" FOREIGN KEY ("deferredChargeId") REFERENCES "accounting_deferred_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_provision_templates"
  ADD CONSTRAINT "accounting_provision_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_provision_templates_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_provision_templates_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_provision_runs"
  ADD CONSTRAINT "accounting_provision_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_provision_runs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "accounting_provision_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
