CREATE TABLE "payroll_dian_processing_jobs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "payrollRecordId" TEXT,
  "payrollBatchId" TEXT,
  "branchId" TEXT,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "triggeredById" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "responseCode" TEXT,
  "responseMessage" TEXT,
  "payload" JSONB,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_dian_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_dian_processing_jobs_company_status_created_idx"
  ON "payroll_dian_processing_jobs"("companyId","status","createdAt");

CREATE INDEX "payroll_dian_processing_jobs_record_idx"
  ON "payroll_dian_processing_jobs"("payrollRecordId");

CREATE INDEX "payroll_dian_processing_jobs_batch_idx"
  ON "payroll_dian_processing_jobs"("payrollBatchId");

CREATE INDEX "payroll_dian_processing_jobs_branch_idx"
  ON "payroll_dian_processing_jobs"("branchId");

ALTER TABLE "payroll_dian_processing_jobs"
  ADD CONSTRAINT "payroll_dian_processing_jobs_company_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_dian_processing_jobs"
  ADD CONSTRAINT "payroll_dian_processing_jobs_record_fkey"
  FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_dian_processing_jobs"
  ADD CONSTRAINT "payroll_dian_processing_jobs_batch_fkey"
  FOREIGN KEY ("payrollBatchId") REFERENCES "payroll_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_dian_processing_jobs"
  ADD CONSTRAINT "payroll_dian_processing_jobs_branch_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_dian_processing_jobs"
  ADD CONSTRAINT "payroll_dian_processing_jobs_triggered_by_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
