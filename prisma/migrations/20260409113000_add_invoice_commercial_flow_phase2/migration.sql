ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceQuoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourcePosSaleId" TEXT,
  ADD COLUMN IF NOT EXISTS "billingMode" TEXT DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS "appliedAdvanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "salesOrderItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNoteItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceQuoteItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourcePosSaleItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceQuantity" DECIMAL(12,4);

CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT NOT NULL,
  "quoteId" TEXT,
  "posSaleId" TEXT,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "requestedDate" TIMESTAMP(3),
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_order_items" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "sourceQuoteItemId" TEXT,
  "sourcePosSaleItemId" TEXT,
  "description" TEXT NOT NULL,
  "orderedQuantity" DECIMAL(12,4) NOT NULL,
  "deliveredQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "invoicedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "delivery_notes" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT NOT NULL,
  "salesOrderId" TEXT,
  "posSaleId" TEXT,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "delivery_note_items" (
  "id" TEXT NOT NULL,
  "deliveryNoteId" TEXT NOT NULL,
  "salesOrderItemId" TEXT,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "invoicedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL,
  "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "delivery_note_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_companyId_number_key" ON "sales_orders"("companyId", "number");
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_notes_companyId_number_key" ON "delivery_notes"("companyId", "number");
CREATE INDEX IF NOT EXISTS "sales_orders_company_status_issue_idx" ON "sales_orders"("companyId", "status", "issueDate");
CREATE INDEX IF NOT EXISTS "sales_orders_branchId_idx" ON "sales_orders"("branchId");
CREATE INDEX IF NOT EXISTS "sales_orders_quoteId_idx" ON "sales_orders"("quoteId");
CREATE INDEX IF NOT EXISTS "sales_orders_posSaleId_idx" ON "sales_orders"("posSaleId");
CREATE INDEX IF NOT EXISTS "sales_order_items_orderId_idx" ON "sales_order_items"("orderId");
CREATE INDEX IF NOT EXISTS "delivery_notes_company_status_issue_idx" ON "delivery_notes"("companyId", "status", "issueDate");
CREATE INDEX IF NOT EXISTS "delivery_notes_salesOrderId_idx" ON "delivery_notes"("salesOrderId");
CREATE INDEX IF NOT EXISTS "delivery_notes_posSaleId_idx" ON "delivery_notes"("posSaleId");
CREATE INDEX IF NOT EXISTS "delivery_note_items_deliveryNoteId_idx" ON "delivery_note_items"("deliveryNoteId");
CREATE INDEX IF NOT EXISTS "invoices_salesOrderId_idx" ON "invoices"("salesOrderId");
CREATE INDEX IF NOT EXISTS "invoices_deliveryNoteId_idx" ON "invoices"("deliveryNoteId");
CREATE INDEX IF NOT EXISTS "invoices_sourceQuoteId_idx" ON "invoices"("sourceQuoteId");
CREATE INDEX IF NOT EXISTS "invoices_sourcePosSaleId_idx" ON "invoices"("sourcePosSaleId");
CREATE INDEX IF NOT EXISTS "invoice_items_salesOrderItemId_idx" ON "invoice_items"("salesOrderItemId");
CREATE INDEX IF NOT EXISTS "invoice_items_deliveryNoteItemId_idx" ON "invoice_items"("deliveryNoteItemId");

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_notes"
  ADD CONSTRAINT "delivery_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_notes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_notes_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_notes_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_note_items"
  ADD CONSTRAINT "delivery_note_items_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_note_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_note_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_items_deliveryNoteItemId_fkey" FOREIGN KEY ("deliveryNoteItemId") REFERENCES "delivery_note_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
