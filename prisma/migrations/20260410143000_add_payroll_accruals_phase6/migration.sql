CREATE TABLE "payroll_accrual_balances" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "branchId" TEXT,
  "period" TEXT NOT NULL,
  "primaAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "cesantiasAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "interestsAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "vacationAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lastPayrollRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_accrual_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_provision_runs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "totalPrima" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCesantias" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalInterests" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalVacations" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "journalEntryId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_provision_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_accrual_balances_companyId_employeeId_period_key" ON "payroll_accrual_balances"("companyId","employeeId","period");
CREATE INDEX "payroll_accrual_balances_branchId_idx" ON "payroll_accrual_balances"("branchId");
CREATE INDEX "payroll_accrual_balances_companyId_period_idx" ON "payroll_accrual_balances"("companyId","period");
CREATE UNIQUE INDEX "payroll_provision_runs_companyId_branchId_period_key" ON "payroll_provision_runs"("companyId","branchId","period");
CREATE INDEX "payroll_provision_runs_journalEntryId_idx" ON "payroll_provision_runs"("journalEntryId");
CREATE INDEX "payroll_provision_runs_companyId_period_idx" ON "payroll_provision_runs"("companyId","period");

ALTER TABLE "payroll_accrual_balances"
  ADD CONSTRAINT "payroll_accrual_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_accrual_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_accrual_balances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_provision_runs"
  ADD CONSTRAINT "payroll_provision_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_provision_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_provision_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
