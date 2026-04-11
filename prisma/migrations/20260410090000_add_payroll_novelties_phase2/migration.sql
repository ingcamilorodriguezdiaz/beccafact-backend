CREATE TYPE "PayrollNoveltyType" AS ENUM (
  'OVERTIME',
  'SURCHARGE',
  'SICK_LEAVE',
  'LICENSE',
  'VACATION',
  'LOAN',
  'GARNISHMENT',
  'ADMISSION',
  'TERMINATION',
  'SALARY_CHANGE',
  'OTHER_EARNING',
  'OTHER_DEDUCTION'
);

CREATE TYPE "PayrollNoveltyStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

ALTER TABLE "employees"
  ADD COLUMN "terminationDate" TIMESTAMP(3);

CREATE TABLE "payroll_novelties" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "branchId" TEXT,
  "payrollRecordId" TEXT,
  "type" "PayrollNoveltyType" NOT NULL,
  "status" "PayrollNoveltyStatus" NOT NULL DEFAULT 'PENDING',
  "period" TEXT,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "hours" DECIMAL(8,2),
  "days" DECIMAL(8,2),
  "quantity" DECIMAL(12,2),
  "rate" DECIMAL(12,4),
  "amount" DECIMAL(12,2),
  "description" TEXT,
  "notes" TEXT,
  "salaryFrom" DECIMAL(12,2),
  "salaryTo" DECIMAL(12,2),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_novelties_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_novelties_companyId_employeeId_status_idx" ON "payroll_novelties"("companyId", "employeeId", "status");
CREATE INDEX "payroll_novelties_companyId_period_type_idx" ON "payroll_novelties"("companyId", "period", "type");
CREATE INDEX "payroll_novelties_payrollRecordId_idx" ON "payroll_novelties"("payrollRecordId");

ALTER TABLE "payroll_novelties"
  ADD CONSTRAINT "payroll_novelties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_novelties_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_novelties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_novelties_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
