CREATE TABLE "payroll_contract_history" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "branchId" TEXT,
  "payrollPolicyId" TEXT,
  "payrollTypeConfigId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "contractType" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "baseSalary" DECIMAL(12,2) NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "changeReason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_contract_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_employment_events" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "branchId" TEXT,
  "payrollRecordId" TEXT,
  "eventType" TEXT NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_employment_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payroll_contract_history"
  ADD CONSTRAINT "payroll_contract_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_contract_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_contract_history_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_contract_history_payrollPolicyId_fkey" FOREIGN KEY ("payrollPolicyId") REFERENCES "payroll_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_contract_history_payrollTypeConfigId_fkey" FOREIGN KEY ("payrollTypeConfigId") REFERENCES "payroll_type_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_employment_events"
  ADD CONSTRAINT "payroll_employment_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_employment_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_employment_events_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_employment_events_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payroll_contract_history_companyId_employeeId_status_idx" ON "payroll_contract_history"("companyId", "employeeId", "status");
CREATE INDEX "payroll_contract_history_branchId_idx" ON "payroll_contract_history"("branchId");
CREATE INDEX "payroll_contract_history_payrollPolicyId_idx" ON "payroll_contract_history"("payrollPolicyId");
CREATE INDEX "payroll_contract_history_payrollTypeConfigId_idx" ON "payroll_contract_history"("payrollTypeConfigId");
CREATE INDEX "payroll_employment_events_companyId_employeeId_effectiveDate_idx" ON "payroll_employment_events"("companyId", "employeeId", "effectiveDate");
CREATE INDEX "payroll_employment_events_payrollRecordId_idx" ON "payroll_employment_events"("payrollRecordId");
