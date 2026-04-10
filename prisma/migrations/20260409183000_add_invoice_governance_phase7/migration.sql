CREATE TABLE "invoice_approval_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_attachments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "mimeType" TEXT,
  "category" TEXT,
  "notes" TEXT,
  "sizeBytes" INTEGER,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_approval_requests_company_invoice_status_idx"
  ON "invoice_approval_requests"("companyId","invoiceId","status");

CREATE INDEX "invoice_approval_requests_company_action_status_idx"
  ON "invoice_approval_requests"("companyId","actionType","status");

CREATE INDEX "invoice_attachments_company_invoice_idx"
  ON "invoice_attachments"("companyId","invoiceId");

ALTER TABLE "invoice_approval_requests"
  ADD CONSTRAINT "invoice_approval_requests_company_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_approval_requests"
  ADD CONSTRAINT "invoice_approval_requests_invoice_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_approval_requests"
  ADD CONSTRAINT "invoice_approval_requests_requested_by_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_approval_requests"
  ADD CONSTRAINT "invoice_approval_requests_approved_by_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_attachments"
  ADD CONSTRAINT "invoice_attachments_company_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_attachments"
  ADD CONSTRAINT "invoice_attachments_invoice_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_attachments"
  ADD CONSTRAINT "invoice_attachments_uploaded_by_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
