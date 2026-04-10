CREATE TABLE "invoice_dian_processing_jobs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "branchId" TEXT,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceChannel" TEXT,
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
  CONSTRAINT "invoice_dian_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_external_intakes" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "linkedInvoiceId" TEXT,
  "channel" TEXT NOT NULL,
  "externalRef" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "customerPayload" JSONB,
  "invoicePayload" JSONB,
  "notes" TEXT,
  "triggeredById" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_external_intakes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_external_intakes_companyId_channel_externalRef_key"
  ON "invoice_external_intakes"("companyId", "channel", "externalRef");

CREATE INDEX "invoice_dian_processing_jobs_companyId_status_createdAt_idx"
  ON "invoice_dian_processing_jobs"("companyId", "status", "createdAt");
CREATE INDEX "invoice_dian_processing_jobs_invoiceId_idx"
  ON "invoice_dian_processing_jobs"("invoiceId");
CREATE INDEX "invoice_dian_processing_jobs_branchId_idx"
  ON "invoice_dian_processing_jobs"("branchId");

CREATE INDEX "invoice_external_intakes_companyId_status_createdAt_idx"
  ON "invoice_external_intakes"("companyId", "status", "createdAt");
CREATE INDEX "invoice_external_intakes_branchId_idx"
  ON "invoice_external_intakes"("branchId");
CREATE INDEX "invoice_external_intakes_linkedInvoiceId_idx"
  ON "invoice_external_intakes"("linkedInvoiceId");

ALTER TABLE "invoice_dian_processing_jobs"
  ADD CONSTRAINT "invoice_dian_processing_jobs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_dian_processing_jobs"
  ADD CONSTRAINT "invoice_dian_processing_jobs_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_dian_processing_jobs"
  ADD CONSTRAINT "invoice_dian_processing_jobs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_dian_processing_jobs"
  ADD CONSTRAINT "invoice_dian_processing_jobs_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_external_intakes"
  ADD CONSTRAINT "invoice_external_intakes_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_external_intakes"
  ADD CONSTRAINT "invoice_external_intakes_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_external_intakes"
  ADD CONSTRAINT "invoice_external_intakes_linkedInvoiceId_fkey"
  FOREIGN KEY ("linkedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_external_intakes"
  ADD CONSTRAINT "invoice_external_intakes_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
