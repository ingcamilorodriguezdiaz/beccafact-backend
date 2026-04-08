CREATE TYPE "PurchaseRequestStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ORDERED',
  'CANCELLED'
);

CREATE TYPE "PurchaseRequestApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "PurchaseReceiptStatus" AS ENUM (
  'DRAFT',
  'POSTED',
  'CANCELLED'
);

ALTER TABLE "purchase_orders"
ADD COLUMN "sourceRequestId" TEXT;

CREATE TABLE "purchase_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "requestDate" TIMESTAMP(3) NOT NULL,
  "neededByDate" TIMESTAMP(3),
  "notes" TEXT,
  "customerId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_request_items" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "estimatedUnitPrice" DECIMAL(12,2),
  "position" INTEGER NOT NULL,
  CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_request_approvals" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "PurchaseRequestApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "decidedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_request_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_receipts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseReceiptStatus" NOT NULL DEFAULT 'DRAFT',
  "receiptDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_order_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_receipt_items" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "description" TEXT NOT NULL,
  "orderedQuantity" DECIMAL(12,4),
  "receivedQuantity" DECIMAL(12,4) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "purchase_order_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_requests_companyId_number_key" ON "purchase_requests"("companyId", "number");
CREATE INDEX "purchase_requests_companyId_idx" ON "purchase_requests"("companyId");
CREATE INDEX "purchase_requests_companyId_status_idx" ON "purchase_requests"("companyId", "status");
CREATE INDEX "purchase_requests_customerId_idx" ON "purchase_requests"("customerId");

CREATE INDEX "purchase_request_items_requestId_idx" ON "purchase_request_items"("requestId");

CREATE INDEX "purchase_request_approvals_companyId_idx" ON "purchase_request_approvals"("companyId");
CREATE INDEX "purchase_request_approvals_requestId_idx" ON "purchase_request_approvals"("requestId");

CREATE UNIQUE INDEX "purchase_order_receipts_companyId_number_key" ON "purchase_order_receipts"("companyId", "number");
CREATE INDEX "purchase_order_receipts_companyId_idx" ON "purchase_order_receipts"("companyId");
CREATE INDEX "purchase_order_receipts_orderId_idx" ON "purchase_order_receipts"("orderId");
CREATE INDEX "purchase_order_receipts_companyId_status_idx" ON "purchase_order_receipts"("companyId", "status");

CREATE INDEX "purchase_order_receipt_items_receiptId_idx" ON "purchase_order_receipt_items"("receiptId");
CREATE INDEX "purchase_order_receipt_items_orderItemId_idx" ON "purchase_order_receipt_items"("orderItemId");

CREATE INDEX "purchase_orders_sourceRequestId_idx" ON "purchase_orders"("sourceRequestId");

ALTER TABLE "purchase_orders"
ADD CONSTRAINT "purchase_orders_sourceRequestId_fkey"
FOREIGN KEY ("sourceRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requests"
ADD CONSTRAINT "purchase_requests_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_requests"
ADD CONSTRAINT "purchase_requests_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requests"
ADD CONSTRAINT "purchase_requests_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_request_items"
ADD CONSTRAINT "purchase_request_items_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_request_items"
ADD CONSTRAINT "purchase_request_items_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_request_approvals"
ADD CONSTRAINT "purchase_request_approvals_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_request_approvals"
ADD CONSTRAINT "purchase_request_approvals_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_request_approvals"
ADD CONSTRAINT "purchase_request_approvals_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_receipts"
ADD CONSTRAINT "purchase_order_receipts_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_receipts"
ADD CONSTRAINT "purchase_order_receipts_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_receipts"
ADD CONSTRAINT "purchase_order_receipts_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_receipt_items"
ADD CONSTRAINT "purchase_order_receipt_items_receiptId_fkey"
FOREIGN KEY ("receiptId") REFERENCES "purchase_order_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_receipt_items"
ADD CONSTRAINT "purchase_order_receipt_items_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
