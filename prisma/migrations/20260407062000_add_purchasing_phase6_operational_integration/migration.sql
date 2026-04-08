DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountPayableScheduleStatus') THEN
    CREATE TYPE "AccountPayableScheduleStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseAdvanceStatus') THEN
    CREATE TYPE "PurchaseAdvanceStatus" AS ENUM ('OPEN', 'PARTIAL', 'APPLIED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseInventoryMovementType') THEN
    CREATE TYPE "PurchaseInventoryMovementType" AS ENUM ('RECEIPT_IN', 'RECEIPT_REVERSAL_OUT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "purchase_advances" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseAdvanceStatus" NOT NULL DEFAULT 'OPEN',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "appliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balance" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_advances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_advance_applications" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "purchaseAdvanceId" TEXT NOT NULL,
  "accountPayableId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "applicationDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_advance_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account_payable_schedules" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "accountPayableId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balance" DECIMAL(12,2) NOT NULL,
  "status" "AccountPayableScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_payable_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_inventory_movements" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "receiptId" TEXT,
  "adjustmentId" TEXT,
  "type" "PurchaseInventoryMovementType" NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitCost" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_advances_companyId_number_key" ON "purchase_advances"("companyId", "number");
CREATE INDEX IF NOT EXISTS "purchase_advances_companyId_status_idx" ON "purchase_advances"("companyId", "status");
CREATE INDEX IF NOT EXISTS "purchase_advances_customerId_idx" ON "purchase_advances"("customerId");

CREATE INDEX IF NOT EXISTS "purchase_advance_applications_companyId_applicationDate_idx" ON "purchase_advance_applications"("companyId", "applicationDate");
CREATE INDEX IF NOT EXISTS "purchase_advance_applications_purchaseAdvanceId_idx" ON "purchase_advance_applications"("purchaseAdvanceId");
CREATE INDEX IF NOT EXISTS "purchase_advance_applications_accountPayableId_idx" ON "purchase_advance_applications"("accountPayableId");

CREATE UNIQUE INDEX IF NOT EXISTS "account_payable_schedules_companyId_number_key" ON "account_payable_schedules"("companyId", "number");
CREATE INDEX IF NOT EXISTS "account_payable_schedules_companyId_status_idx" ON "account_payable_schedules"("companyId", "status");
CREATE INDEX IF NOT EXISTS "account_payable_schedules_accountPayableId_idx" ON "account_payable_schedules"("accountPayableId");

CREATE INDEX IF NOT EXISTS "purchase_inventory_movements_companyId_type_idx" ON "purchase_inventory_movements"("companyId", "type");
CREATE INDEX IF NOT EXISTS "purchase_inventory_movements_productId_idx" ON "purchase_inventory_movements"("productId");
CREATE INDEX IF NOT EXISTS "purchase_inventory_movements_receiptId_idx" ON "purchase_inventory_movements"("receiptId");
CREATE INDEX IF NOT EXISTS "purchase_inventory_movements_adjustmentId_idx" ON "purchase_inventory_movements"("adjustmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advances_companyId_fkey'
  ) THEN
    ALTER TABLE "purchase_advances"
      ADD CONSTRAINT "purchase_advances_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advances_customerId_fkey'
  ) THEN
    ALTER TABLE "purchase_advances"
      ADD CONSTRAINT "purchase_advances_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advances_createdById_fkey'
  ) THEN
    ALTER TABLE "purchase_advances"
      ADD CONSTRAINT "purchase_advances_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advance_applications_companyId_fkey'
  ) THEN
    ALTER TABLE "purchase_advance_applications"
      ADD CONSTRAINT "purchase_advance_applications_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advance_applications_purchaseAdvanceId_fkey'
  ) THEN
    ALTER TABLE "purchase_advance_applications"
      ADD CONSTRAINT "purchase_advance_applications_purchaseAdvanceId_fkey"
      FOREIGN KEY ("purchaseAdvanceId") REFERENCES "purchase_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_advance_applications_accountPayableId_fkey'
  ) THEN
    ALTER TABLE "purchase_advance_applications"
      ADD CONSTRAINT "purchase_advance_applications_accountPayableId_fkey"
      FOREIGN KEY ("accountPayableId") REFERENCES "accounts_payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_payable_schedules_companyId_fkey'
  ) THEN
    ALTER TABLE "account_payable_schedules"
      ADD CONSTRAINT "account_payable_schedules_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_payable_schedules_accountPayableId_fkey'
  ) THEN
    ALTER TABLE "account_payable_schedules"
      ADD CONSTRAINT "account_payable_schedules_accountPayableId_fkey"
      FOREIGN KEY ("accountPayableId") REFERENCES "accounts_payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_inventory_movements_companyId_fkey'
  ) THEN
    ALTER TABLE "purchase_inventory_movements"
      ADD CONSTRAINT "purchase_inventory_movements_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_inventory_movements_productId_fkey'
  ) THEN
    ALTER TABLE "purchase_inventory_movements"
      ADD CONSTRAINT "purchase_inventory_movements_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_inventory_movements_receiptId_fkey'
  ) THEN
    ALTER TABLE "purchase_inventory_movements"
      ADD CONSTRAINT "purchase_inventory_movements_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "purchase_order_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_inventory_movements_adjustmentId_fkey'
  ) THEN
    ALTER TABLE "purchase_inventory_movements"
      ADD CONSTRAINT "purchase_inventory_movements_adjustmentId_fkey"
      FOREIGN KEY ("adjustmentId") REFERENCES "purchase_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
