ALTER TABLE "invoices"
  ADD COLUMN "inventoryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "inventoryAppliedAt" TIMESTAMP(3),
  ADD COLUMN "inventoryReversedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE "delivery_notes"
  ADD COLUMN "inventoryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "inventoryAppliedAt" TIMESTAMP(3);

CREATE TABLE "invoice_inventory_movements" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "invoiceId" TEXT,
  "deliveryNoteId" TEXT,
  "productId" TEXT NOT NULL,
  "movementType" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_inventory_movements_company_type_created_idx"
  ON "invoice_inventory_movements"("companyId", "movementType", "createdAt");

CREATE INDEX "invoice_inventory_movements_invoice_idx"
  ON "invoice_inventory_movements"("invoiceId");

CREATE INDEX "invoice_inventory_movements_delivery_idx"
  ON "invoice_inventory_movements"("deliveryNoteId");

CREATE INDEX "invoice_inventory_movements_product_idx"
  ON "invoice_inventory_movements"("productId");

ALTER TABLE "invoice_inventory_movements"
  ADD CONSTRAINT "invoice_inventory_movements_company_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_inventory_movements"
  ADD CONSTRAINT "invoice_inventory_movements_invoice_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_inventory_movements"
  ADD CONSTRAINT "invoice_inventory_movements_delivery_note_fkey"
  FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_inventory_movements"
  ADD CONSTRAINT "invoice_inventory_movements_product_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
