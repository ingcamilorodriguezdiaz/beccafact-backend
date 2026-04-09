DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosPostSaleType') THEN
    CREATE TYPE "PosPostSaleType" AS ENUM ('RETURN', 'EXCHANGE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosPostSaleStatus') THEN
    CREATE TYPE "PosPostSaleStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosPostSaleReason') THEN
    CREATE TYPE "PosPostSaleReason" AS ENUM (
      'DEFECTIVE_PRODUCT',
      'WRONG_PRODUCT',
      'CUSTOMER_DISSATISFACTION',
      'BILLING_ERROR',
      'WARRANTY',
      'OTHER'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosPostSaleLineType') THEN
    CREATE TYPE "PosPostSaleLineType" AS ENUM ('RETURN', 'REPLACEMENT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "pos_post_sale_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT,
  "approvedById" TEXT,
  "type" "PosPostSaleType" NOT NULL,
  "status" "PosPostSaleStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "reasonCode" "PosPostSaleReason" NOT NULL,
  "reasonDetail" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "creditNoteInvoiceId" TEXT,
  "exchangeSnapshot" JSONB,
  "approvalNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  CONSTRAINT "pos_post_sale_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_post_sale_request_items" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "lineType" "PosPostSaleLineType" NOT NULL,
  "saleItemId" TEXT,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "pos_post_sale_request_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_post_sale_requests_companyId_status_createdAt_idx"
  ON "pos_post_sale_requests"("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "pos_post_sale_requests_saleId_idx"
  ON "pos_post_sale_requests"("saleId");
CREATE INDEX IF NOT EXISTS "pos_post_sale_request_items_requestId_lineType_idx"
  ON "pos_post_sale_request_items"("requestId", "lineType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_saleId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_branchId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_createdById_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_approvedById_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_approvedById_fkey"
      FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_requests_creditNoteInvoiceId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_requests"
      ADD CONSTRAINT "pos_post_sale_requests_creditNoteInvoiceId_fkey"
      FOREIGN KEY ("creditNoteInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_request_items_requestId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_request_items"
      ADD CONSTRAINT "pos_post_sale_request_items_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "pos_post_sale_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_request_items_saleItemId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_request_items"
      ADD CONSTRAINT "pos_post_sale_request_items_saleItemId_fkey"
      FOREIGN KEY ("saleItemId") REFERENCES "pos_sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_post_sale_request_items_productId_fkey'
  ) THEN
    ALTER TABLE "pos_post_sale_request_items"
      ADD CONSTRAINT "pos_post_sale_request_items_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
