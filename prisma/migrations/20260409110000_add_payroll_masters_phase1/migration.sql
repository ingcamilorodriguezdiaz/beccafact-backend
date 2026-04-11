-- Payroll phase 1: labor configuration masters

CREATE TYPE "PayrollConceptNature" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "PayrollConceptFormulaType" AS ENUM ('MANUAL', 'FIXED_AMOUNT', 'BASE_SALARY_PERCENT', 'PROPORTIONAL_SALARY_PERCENT', 'OVERTIME_FACTOR');
CREATE TYPE "PayrollCalendarFrequency" AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY', 'SPECIAL');

CREATE TABLE "payroll_concepts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "nature" "PayrollConceptNature" NOT NULL,
  "formulaType" "PayrollConceptFormulaType" NOT NULL DEFAULT 'MANUAL',
  "formulaExpression" TEXT,
  "defaultAmount" DECIMAL(12,2),
  "defaultRate" DECIMAL(8,4),
  "quantityDefault" DECIMAL(12,2),
  "affectsSocialSecurity" BOOLEAN NOT NULL DEFAULT false,
  "affectsParafiscals" BOOLEAN NOT NULL DEFAULT false,
  "appliesByDefault" BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_concepts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_calendars" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "frequency" "PayrollCalendarFrequency" NOT NULL DEFAULT 'MONTHLY',
  "cutoffDay" INTEGER,
  "paymentDay" INTEGER,
  "startDay" INTEGER,
  "endDay" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_calendars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_policies" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "applyAutoTransport" BOOLEAN NOT NULL DEFAULT true,
  "transportAllowanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 162000,
  "transportCapMultiplier" DECIMAL(8,2) NOT NULL DEFAULT 2,
  "healthEmployeeRate" DECIMAL(8,4) NOT NULL DEFAULT 0.04,
  "pensionEmployeeRate" DECIMAL(8,4) NOT NULL DEFAULT 0.04,
  "healthEmployerRate" DECIMAL(8,4) NOT NULL DEFAULT 0.085,
  "pensionEmployerRate" DECIMAL(8,4) NOT NULL DEFAULT 0.12,
  "arlRate" DECIMAL(8,5) NOT NULL DEFAULT 0.00522,
  "compensationFundRate" DECIMAL(8,4) NOT NULL DEFAULT 0.04,
  "overtimeFactor" DECIMAL(8,4) NOT NULL DEFAULT 1.25,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_type_configs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'ORDINARIA',
  "description" TEXT,
  "calendarId" TEXT,
  "policyId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_type_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_record_concepts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "payrollRecordId" TEXT NOT NULL,
  "conceptId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nature" "PayrollConceptNature" NOT NULL,
  "formulaType" "PayrollConceptFormulaType" NOT NULL DEFAULT 'MANUAL',
  "quantity" DECIMAL(12,2),
  "rate" DECIMAL(12,4),
  "amount" DECIMAL(12,2) NOT NULL,
  "source" TEXT DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_record_concepts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "employees"
  ADD COLUMN "payrollPolicyId" TEXT,
  ADD COLUMN "payrollTypeConfigId" TEXT;

ALTER TABLE "payroll_records"
  ADD COLUMN "payrollCalendarId" TEXT,
  ADD COLUMN "payrollPolicyId" TEXT,
  ADD COLUMN "payrollTypeConfigId" TEXT,
  ADD COLUMN "payrollCategory" TEXT DEFAULT 'ORDINARIA',
  ADD COLUMN "configSnapshot" JSONB;

CREATE UNIQUE INDEX "payroll_concepts_companyId_code_key" ON "payroll_concepts"("companyId", "code");
CREATE INDEX "payroll_concepts_companyId_branchId_isActive_idx" ON "payroll_concepts"("companyId", "branchId", "isActive");

CREATE UNIQUE INDEX "payroll_calendars_companyId_code_key" ON "payroll_calendars"("companyId", "code");
CREATE INDEX "payroll_calendars_companyId_branchId_isActive_idx" ON "payroll_calendars"("companyId", "branchId", "isActive");

CREATE INDEX "payroll_policies_companyId_branchId_isActive_idx" ON "payroll_policies"("companyId", "branchId", "isActive");

CREATE UNIQUE INDEX "payroll_type_configs_companyId_code_key" ON "payroll_type_configs"("companyId", "code");
CREATE INDEX "payroll_type_configs_companyId_branchId_isActive_idx" ON "payroll_type_configs"("companyId", "branchId", "isActive");
CREATE INDEX "payroll_type_configs_calendarId_idx" ON "payroll_type_configs"("calendarId");
CREATE INDEX "payroll_type_configs_policyId_idx" ON "payroll_type_configs"("policyId");

CREATE INDEX "payroll_record_concepts_companyId_payrollRecordId_idx" ON "payroll_record_concepts"("companyId", "payrollRecordId");
CREATE INDEX "payroll_record_concepts_conceptId_idx" ON "payroll_record_concepts"("conceptId");

CREATE INDEX "employees_payrollPolicyId_idx" ON "employees"("payrollPolicyId");
CREATE INDEX "employees_payrollTypeConfigId_idx" ON "employees"("payrollTypeConfigId");

CREATE INDEX "payroll_records_payrollCalendarId_idx" ON "payroll_records"("payrollCalendarId");
CREATE INDEX "payroll_records_payrollPolicyId_idx" ON "payroll_records"("payrollPolicyId");
CREATE INDEX "payroll_records_payrollTypeConfigId_idx" ON "payroll_records"("payrollTypeConfigId");

ALTER TABLE "payroll_concepts" ADD CONSTRAINT "payroll_concepts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_concepts" ADD CONSTRAINT "payroll_concepts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_calendars" ADD CONSTRAINT "payroll_calendars_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_calendars" ADD CONSTRAINT "payroll_calendars_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_policies" ADD CONSTRAINT "payroll_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_policies" ADD CONSTRAINT "payroll_policies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_type_configs" ADD CONSTRAINT "payroll_type_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_type_configs" ADD CONSTRAINT "payroll_type_configs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_type_configs" ADD CONSTRAINT "payroll_type_configs_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "payroll_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_type_configs" ADD CONSTRAINT "payroll_type_configs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "payroll_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_record_concepts" ADD CONSTRAINT "payroll_record_concepts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_record_concepts" ADD CONSTRAINT "payroll_record_concepts_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_record_concepts" ADD CONSTRAINT "payroll_record_concepts_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "payroll_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employees" ADD CONSTRAINT "employees_payrollPolicyId_fkey" FOREIGN KEY ("payrollPolicyId") REFERENCES "payroll_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_payrollTypeConfigId_fkey" FOREIGN KEY ("payrollTypeConfigId") REFERENCES "payroll_type_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_payrollCalendarId_fkey" FOREIGN KEY ("payrollCalendarId") REFERENCES "payroll_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_payrollPolicyId_fkey" FOREIGN KEY ("payrollPolicyId") REFERENCES "payroll_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_payrollTypeConfigId_fkey" FOREIGN KEY ("payrollTypeConfigId") REFERENCES "payroll_type_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
