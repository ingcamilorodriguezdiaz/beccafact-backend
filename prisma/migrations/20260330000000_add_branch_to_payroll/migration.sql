-- Add branchId to employees
ALTER TABLE "employees" ADD COLUMN "branchId" TEXT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "employees_branchId_idx" ON "employees"("branchId");

-- Add branchId to payroll_records
ALTER TABLE "payroll_records" ADD COLUMN "branchId" TEXT;
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "payroll_records_branchId_idx" ON "payroll_records"("branchId");
