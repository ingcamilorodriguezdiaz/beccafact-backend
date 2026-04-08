CREATE TYPE "PurchaseSupplierQuoteStatus" AS ENUM ('RECEIVED', 'AWARDED', 'REJECTED', 'EXPIRED');
CREATE TYPE "PurchaseFrameworkAgreementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');

ALTER TABLE "purchase_orders" ADD COLUMN "awardedQuoteId" TEXT;

CREATE TABLE "purchase_supplier_quotes" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "purchaseRequestId" TEXT,
  "number" TEXT NOT NULL,
  "status" "PurchaseSupplierQuoteStatus" NOT NULL DEFAULT 'RECEIVED',
  "validUntil" TIMESTAMP(3),
  "leadTimeDays" INTEGER,
  "paymentTermDays" INTEGER,
  "notes" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "score" DECIMAL(8,2),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_supplier_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_supplier_quote_items" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "requestItemId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "purchase_supplier_quote_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_framework_agreements" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseFrameworkAgreementStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "paymentTermDays" INTEGER,
  "leadTimeDays" INTEGER,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_framework_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_framework_agreement_items" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "minQuantity" DECIMAL(12,4),
  "notes" TEXT,
  "position" INTEGER NOT NULL,
  CONSTRAINT "purchase_framework_agreement_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_supplier_quotes_companyId_number_key" ON "purchase_supplier_quotes"("companyId", "number");
CREATE INDEX "purchase_supplier_quotes_companyId_status_idx" ON "purchase_supplier_quotes"("companyId", "status");
CREATE INDEX "purchase_supplier_quotes_customerId_idx" ON "purchase_supplier_quotes"("customerId");
CREATE INDEX "purchase_supplier_quotes_purchaseRequestId_idx" ON "purchase_supplier_quotes"("purchaseRequestId");
CREATE UNIQUE INDEX "purchase_orders_awardedQuoteId_key" ON "purchase_orders"("awardedQuoteId");
CREATE INDEX "purchase_orders_awardedQuoteId_idx" ON "purchase_orders"("awardedQuoteId");

CREATE INDEX "purchase_supplier_quote_items_quoteId_idx" ON "purchase_supplier_quote_items"("quoteId");

CREATE UNIQUE INDEX "purchase_framework_agreements_companyId_number_key" ON "purchase_framework_agreements"("companyId", "number");
CREATE INDEX "purchase_framework_agreements_companyId_status_idx" ON "purchase_framework_agreements"("companyId", "status");
CREATE INDEX "purchase_framework_agreements_customerId_idx" ON "purchase_framework_agreements"("customerId");

CREATE INDEX "purchase_framework_agreement_items_agreementId_idx" ON "purchase_framework_agreement_items"("agreementId");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_awardedQuoteId_fkey" FOREIGN KEY ("awardedQuoteId") REFERENCES "purchase_supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_supplier_quotes"
  ADD CONSTRAINT "purchase_supplier_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_supplier_quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_supplier_quotes_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_supplier_quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_supplier_quote_items"
  ADD CONSTRAINT "purchase_supplier_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "purchase_supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_supplier_quote_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_framework_agreements"
  ADD CONSTRAINT "purchase_framework_agreements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_framework_agreements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_framework_agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_framework_agreement_items"
  ADD CONSTRAINT "purchase_framework_agreement_items_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "purchase_framework_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_framework_agreement_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
