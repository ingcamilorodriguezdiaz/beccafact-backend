CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "AccountPayableStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED');

CREATE TABLE "purchase_invoices" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "receiptId" TEXT,
  "number" TEXT NOT NULL,
  "supplierInvoiceNumber" TEXT NOT NULL,
  "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_invoice_items" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts_payable" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "purchaseInvoiceId" TEXT,
  "number" TEXT NOT NULL,
  "concept" TEXT NOT NULL,
  "status" "AccountPayableStatus" NOT NULL DEFAULT 'OPEN',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "originalAmount" DECIMAL(12,2) NOT NULL,
  "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balance" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "account_payable_payments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "accountPayableId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_payable_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_invoices_companyId_number_key" ON "purchase_invoices"("companyId", "number");
CREATE UNIQUE INDEX "purchase_invoices_companyId_supplierInvoiceNumber_key" ON "purchase_invoices"("companyId", "supplierInvoiceNumber");
CREATE INDEX "purchase_invoices_companyId_status_idx" ON "purchase_invoices"("companyId", "status");
CREATE INDEX "purchase_invoices_customerId_idx" ON "purchase_invoices"("customerId");
CREATE INDEX "purchase_invoices_purchaseOrderId_idx" ON "purchase_invoices"("purchaseOrderId");
CREATE INDEX "purchase_invoices_receiptId_idx" ON "purchase_invoices"("receiptId");

CREATE INDEX "purchase_invoice_items_invoiceId_idx" ON "purchase_invoice_items"("invoiceId");

CREATE UNIQUE INDEX "accounts_payable_companyId_number_key" ON "accounts_payable"("companyId", "number");
CREATE INDEX "accounts_payable_companyId_status_idx" ON "accounts_payable"("companyId", "status");
CREATE INDEX "accounts_payable_customerId_idx" ON "accounts_payable"("customerId");
CREATE INDEX "accounts_payable_purchaseInvoiceId_idx" ON "accounts_payable"("purchaseInvoiceId");

CREATE UNIQUE INDEX "account_payable_payments_companyId_number_key" ON "account_payable_payments"("companyId", "number");
CREATE INDEX "account_payable_payments_companyId_idx" ON "account_payable_payments"("companyId");
CREATE INDEX "account_payable_payments_accountPayableId_idx" ON "account_payable_payments"("accountPayableId");

ALTER TABLE "purchase_invoices"
  ADD CONSTRAINT "purchase_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_invoices_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_order_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_items"
  ADD CONSTRAINT "purchase_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_invoice_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounts_payable"
  ADD CONSTRAINT "accounts_payable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounts_payable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounts_payable_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_payable_payments"
  ADD CONSTRAINT "account_payable_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "account_payable_payments_accountPayableId_fkey" FOREIGN KEY ("accountPayableId") REFERENCES "accounts_payable"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "account_payable_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
