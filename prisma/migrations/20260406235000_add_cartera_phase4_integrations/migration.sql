CREATE TABLE "cartera_bank_movements" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "bankCode" TEXT,
  "accountNumber" TEXT,
  "movementDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "description" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNRECONCILED',
  "matchedReceiptId" TEXT,
  "reconciledById" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "importedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cartera_bank_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cartera_bank_movements_companyId_movementDate_idx"
  ON "cartera_bank_movements"("companyId", "movementDate");

CREATE INDEX "cartera_bank_movements_status_idx"
  ON "cartera_bank_movements"("status");

CREATE INDEX "cartera_bank_movements_matchedReceiptId_idx"
  ON "cartera_bank_movements"("matchedReceiptId");

ALTER TABLE "cartera_bank_movements"
  ADD CONSTRAINT "cartera_bank_movements_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_bank_movements"
  ADD CONSTRAINT "cartera_bank_movements_matchedReceiptId_fkey"
  FOREIGN KEY ("matchedReceiptId") REFERENCES "cartera_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_bank_movements"
  ADD CONSTRAINT "cartera_bank_movements_importedById_fkey"
  FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_bank_movements"
  ADD CONSTRAINT "cartera_bank_movements_reconciledById_fkey"
  FOREIGN KEY ("reconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
