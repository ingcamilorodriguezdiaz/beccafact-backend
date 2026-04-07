CREATE TABLE "cartera_receipts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "appliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unappliedAmount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cartera_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cartera_receipts_status_check" CHECK ("status" IN ('OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'VOID'))
);

CREATE TABLE "cartera_receipt_applications" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cartera_receipt_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cartera_receipts_companyId_number_key"
  ON "cartera_receipts"("companyId", "number");

CREATE INDEX "cartera_receipts_companyId_paymentDate_idx"
  ON "cartera_receipts"("companyId", "paymentDate");

CREATE INDEX "cartera_receipts_customerId_idx"
  ON "cartera_receipts"("customerId");

CREATE INDEX "cartera_receipt_applications_companyId_appliedAt_idx"
  ON "cartera_receipt_applications"("companyId", "appliedAt");

CREATE INDEX "cartera_receipt_applications_receiptId_idx"
  ON "cartera_receipt_applications"("receiptId");

CREATE INDEX "cartera_receipt_applications_invoiceId_idx"
  ON "cartera_receipt_applications"("invoiceId");

ALTER TABLE "cartera_receipts"
  ADD CONSTRAINT "cartera_receipts_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_receipts"
  ADD CONSTRAINT "cartera_receipts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_receipts"
  ADD CONSTRAINT "cartera_receipts_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_receipt_applications"
  ADD CONSTRAINT "cartera_receipt_applications_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_receipt_applications"
  ADD CONSTRAINT "cartera_receipt_applications_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "cartera_receipts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cartera_receipt_applications"
  ADD CONSTRAINT "cartera_receipt_applications_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cartera_receipt_applications"
  ADD CONSTRAINT "cartera_receipt_applications_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
