ALTER TABLE "payroll_concepts"
  ADD COLUMN "accountingAccountId" TEXT,
  ADD COLUMN "costCenter" TEXT,
  ADD COLUMN "projectCode" TEXT;

CREATE INDEX "payroll_concepts_accountingAccountId_idx" ON "payroll_concepts"("accountingAccountId");

ALTER TABLE "payroll_concepts"
  ADD CONSTRAINT "payroll_concepts_accountingAccountId_fkey"
  FOREIGN KEY ("accountingAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payroll_accounting_profiles" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "payrollTypeConfigId" TEXT,
  "profileName" TEXT NOT NULL,
  "expenseAccountId" TEXT NOT NULL,
  "netPayableAccountId" TEXT NOT NULL,
  "employeeDeductionsAccountId" TEXT NOT NULL,
  "employerExpenseAccountId" TEXT NOT NULL,
  "employerContributionsAccountId" TEXT NOT NULL,
  "costCenter" TEXT,
  "projectCode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_accounting_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_accounting_profiles_branchId_idx" ON "payroll_accounting_profiles"("branchId");
CREATE INDEX "payroll_accounting_profiles_companyId_isActive_idx" ON "payroll_accounting_profiles"("companyId","isActive");
CREATE INDEX "payroll_accounting_profiles_payrollTypeConfigId_idx" ON "payroll_accounting_profiles"("payrollTypeConfigId");

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_payrollTypeConfigId_fkey"
  FOREIGN KEY ("payrollTypeConfigId") REFERENCES "payroll_type_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_expenseAccountId_fkey"
  FOREIGN KEY ("expenseAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_netPayableAccountId_fkey"
  FOREIGN KEY ("netPayableAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_employeeDeductionsAccountId_fkey"
  FOREIGN KEY ("employeeDeductionsAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_employerExpenseAccountId_fkey"
  FOREIGN KEY ("employerExpenseAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_accounting_profiles"
  ADD CONSTRAINT "payroll_accounting_profiles_employerContributionsAccountId_fkey"
  FOREIGN KEY ("employerContributionsAccountId") REFERENCES "accounting_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
