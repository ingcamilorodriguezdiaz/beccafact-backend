CREATE TYPE "PayrollBatchStatus" AS ENUM ('DRAFT', 'GENERATED', 'CLOSED');
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "payroll_batches" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "period" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "PayrollBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "totalEmployees" INTEGER NOT NULL DEFAULT 0,
  "generatedRecords" INTEGER NOT NULL DEFAULT 0,
  "totalNetPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalEmployerCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_period_controls" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "period" TEXT NOT NULL,
  "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "closedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_period_controls_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payroll_records"
  ADD COLUMN "payrollBatchId" TEXT;

CREATE INDEX "payroll_batches_companyId_period_status_idx" ON "payroll_batches"("companyId", "period", "status");
CREATE INDEX "payroll_batches_branchId_idx" ON "payroll_batches"("branchId");
CREATE INDEX "payroll_records_payrollBatchId_idx" ON "payroll_records"("payrollBatchId");
CREATE UNIQUE INDEX "payroll_period_controls_companyId_branchId_period_key" ON "payroll_period_controls"("companyId", "branchId", "period");
CREATE INDEX "payroll_period_controls_companyId_period_status_idx" ON "payroll_period_controls"("companyId", "period", "status");

ALTER TABLE "payroll_batches"
  ADD CONSTRAINT "payroll_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_period_controls"
  ADD CONSTRAINT "payroll_period_controls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_period_controls_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_records"
  ADD CONSTRAINT "payroll_records_payrollBatchId_fkey" FOREIGN KEY ("payrollBatchId") REFERENCES "payroll_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
