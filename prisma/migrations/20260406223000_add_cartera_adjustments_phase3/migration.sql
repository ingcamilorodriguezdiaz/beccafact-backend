CREATE TABLE "cartera_adjustments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "receiptId" TEXT,
  "sourceInvoiceId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cartera_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cartera_adjustments_companyId_createdAt_idx"
  ON "cartera_adjustments"("companyId", "createdAt");

CREATE INDEX "cartera_adjustments_customerId_idx"
  ON "cartera_adjustments"("customerId");

CREATE INDEX "cartera_adjustments_invoiceId_idx"
  ON "cartera_adjustments"("invoiceId");

CREATE INDEX "cartera_adjustments_receiptId_idx"
  ON "cartera_adjustments"("receiptId");

CREATE INDEX "cartera_adjustments_status_type_idx"
  ON "cartera_adjustments"("status", "type");

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "cartera_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_sourceInvoiceId_fkey"
  FOREIGN KEY ("sourceInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_adjustments"
  ADD CONSTRAINT "cartera_adjustments_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
