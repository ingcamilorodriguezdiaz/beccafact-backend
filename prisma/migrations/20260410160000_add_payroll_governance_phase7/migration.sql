CREATE TABLE "payroll_approval_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "payrollRecordId" TEXT,
  "payrollBatchId" TEXT,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_attachments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "payrollRecordId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "mimeType" TEXT,
  "category" TEXT,
  "notes" TEXT,
  "sizeBytes" INTEGER,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_approval_requests_company_record_action_status_idx" ON "payroll_approval_requests"("companyId","payrollRecordId","actionType","status");
CREATE INDEX "payroll_approval_requests_company_batch_action_status_idx" ON "payroll_approval_requests"("companyId","payrollBatchId","actionType","status");
CREATE INDEX "payroll_attachments_company_record_idx" ON "payroll_attachments"("companyId","payrollRecordId");

ALTER TABLE "payroll_approval_requests"
  ADD CONSTRAINT "payroll_approval_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_approval_requests_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_approval_requests_payrollBatchId_fkey" FOREIGN KEY ("payrollBatchId") REFERENCES "payroll_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_approval_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_attachments"
  ADD CONSTRAINT "payroll_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_attachments_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
