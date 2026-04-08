CREATE TYPE "PurchaseAdjustmentType" AS ENUM (
  'RETURN',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'RECEIPT_REVERSAL',
  'INVOICE_REVERSAL',
  'PAYMENT_REVERSAL'
);

CREATE TYPE "PurchaseAdjustmentStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPLIED',
  'REJECTED'
);

ALTER TABLE "account_payable_payments"
  ADD COLUMN "reversedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "accounts_payable_purchaseInvoiceId_key" ON "accounts_payable"("purchaseInvoiceId");

CREATE TABLE "purchase_adjustments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "PurchaseAdjustmentType" NOT NULL,
  "status" "PurchaseAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "receiptId" TEXT,
  "purchaseInvoiceId" TEXT,
  "accountPayableId" TEXT,
  "paymentId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_adjustments_companyId_status_idx" ON "purchase_adjustments"("companyId", "status");
CREATE INDEX "purchase_adjustments_customerId_idx" ON "purchase_adjustments"("customerId");
CREATE INDEX "purchase_adjustments_receiptId_idx" ON "purchase_adjustments"("receiptId");
CREATE INDEX "purchase_adjustments_purchaseInvoiceId_idx" ON "purchase_adjustments"("purchaseInvoiceId");
CREATE INDEX "purchase_adjustments_accountPayableId_idx" ON "purchase_adjustments"("accountPayableId");
CREATE INDEX "purchase_adjustments_paymentId_idx" ON "purchase_adjustments"("paymentId");


ALTER TABLE "purchase_adjustments"
  ADD CONSTRAINT "purchase_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_order_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_accountPayableId_fkey" FOREIGN KEY ("accountPayableId") REFERENCES "accounts_payable"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "account_payable_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
