ALTER TABLE "pos_sales"
  ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "loyaltyRedemptionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "couponDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "pos_coupons" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "discountMode" "PosDiscountMode" NOT NULL,
  "discountValue" DECIMAL(12,2) NOT NULL,
  "pointsCost" INTEGER NOT NULL DEFAULT 0,
  "minSubtotal" DECIMAL(12,2),
  "targetSegment" TEXT,
  "targetTier" TEXT,
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_coupon_redemptions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "customerId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "pointsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_external_orders" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT,
  "channel" TEXT NOT NULL,
  "externalOrderNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "orderType" "PosOrderType" NOT NULL DEFAULT 'PICKUP',
  "scheduledAt" TIMESTAMP(3),
  "deliveryAddress" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "payload" JSONB,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_external_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_integration_traces" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT,
  "module" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_integration_traces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_bank_reconciliation_batches" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT,
  "reference" TEXT NOT NULL,
  "totalPayments" INTEGER NOT NULL DEFAULT 0,
  "matchedPayments" INTEGER NOT NULL DEFAULT 0,
  "reconciledPayments" INTEGER NOT NULL DEFAULT 0,
  "differenceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_bank_reconciliation_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pos_coupons_companyId_code_key"
  ON "pos_coupons"("companyId", "code");
CREATE INDEX IF NOT EXISTS "pos_coupons_companyId_branchId_isActive_idx"
  ON "pos_coupons"("companyId", "branchId", "isActive");

CREATE INDEX IF NOT EXISTS "pos_coupon_redemptions_companyId_createdAt_idx"
  ON "pos_coupon_redemptions"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "pos_coupon_redemptions_couponId_idx"
  ON "pos_coupon_redemptions"("couponId");
CREATE INDEX IF NOT EXISTS "pos_coupon_redemptions_saleId_idx"
  ON "pos_coupon_redemptions"("saleId");

CREATE UNIQUE INDEX IF NOT EXISTS "pos_external_orders_companyId_channel_externalOrderNumber_key"
  ON "pos_external_orders"("companyId", "channel", "externalOrderNumber");
CREATE INDEX IF NOT EXISTS "pos_external_orders_companyId_branchId_status_idx"
  ON "pos_external_orders"("companyId", "branchId", "status");

CREATE INDEX IF NOT EXISTS "pos_integration_traces_companyId_module_createdAt_idx"
  ON "pos_integration_traces"("companyId", "module", "createdAt");
CREATE INDEX IF NOT EXISTS "pos_integration_traces_companyId_sourceType_sourceId_idx"
  ON "pos_integration_traces"("companyId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "pos_integration_traces_companyId_targetType_targetId_idx"
  ON "pos_integration_traces"("companyId", "targetType", "targetId");

CREATE UNIQUE INDEX IF NOT EXISTS "pos_bank_reconciliation_batches_companyId_reference_key"
  ON "pos_bank_reconciliation_batches"("companyId", "reference");
CREATE INDEX IF NOT EXISTS "pos_bank_reconciliation_batches_companyId_branchId_createdAt_idx"
  ON "pos_bank_reconciliation_batches"("companyId", "branchId", "createdAt");

CREATE INDEX IF NOT EXISTS "pos_sales_externalOrderId_idx"
  ON "pos_sales"("externalOrderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_externalOrderId_fkey'
  ) THEN
    ALTER TABLE "pos_sales"
      ADD CONSTRAINT "pos_sales_externalOrderId_fkey"
      FOREIGN KEY ("externalOrderId") REFERENCES "pos_external_orders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupons_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_coupons"
      ADD CONSTRAINT "pos_coupons_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupons_branchId_fkey'
  ) THEN
    ALTER TABLE "pos_coupons"
      ADD CONSTRAINT "pos_coupons_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupons_customerId_fkey'
  ) THEN
    ALTER TABLE "pos_coupons"
      ADD CONSTRAINT "pos_coupons_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupon_redemptions_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_coupon_redemptions"
      ADD CONSTRAINT "pos_coupon_redemptions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupon_redemptions_couponId_fkey'
  ) THEN
    ALTER TABLE "pos_coupon_redemptions"
      ADD CONSTRAINT "pos_coupon_redemptions_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "pos_coupons"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupon_redemptions_saleId_fkey'
  ) THEN
    ALTER TABLE "pos_coupon_redemptions"
      ADD CONSTRAINT "pos_coupon_redemptions_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_coupon_redemptions_customerId_fkey'
  ) THEN
    ALTER TABLE "pos_coupon_redemptions"
      ADD CONSTRAINT "pos_coupon_redemptions_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_external_orders_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_external_orders"
      ADD CONSTRAINT "pos_external_orders_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_external_orders_branchId_fkey'
  ) THEN
    ALTER TABLE "pos_external_orders"
      ADD CONSTRAINT "pos_external_orders_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_external_orders_customerId_fkey'
  ) THEN
    ALTER TABLE "pos_external_orders"
      ADD CONSTRAINT "pos_external_orders_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_integration_traces_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_integration_traces"
      ADD CONSTRAINT "pos_integration_traces_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_integration_traces_branchId_fkey'
  ) THEN
    ALTER TABLE "pos_integration_traces"
      ADD CONSTRAINT "pos_integration_traces_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_integration_traces_createdById_fkey'
  ) THEN
    ALTER TABLE "pos_integration_traces"
      ADD CONSTRAINT "pos_integration_traces_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_bank_reconciliation_batches_companyId_fkey'
  ) THEN
    ALTER TABLE "pos_bank_reconciliation_batches"
      ADD CONSTRAINT "pos_bank_reconciliation_batches_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_bank_reconciliation_batches_branchId_fkey'
  ) THEN
    ALTER TABLE "pos_bank_reconciliation_batches"
      ADD CONSTRAINT "pos_bank_reconciliation_batches_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_bank_reconciliation_batches_createdById_fkey'
  ) THEN
    ALTER TABLE "pos_bank_reconciliation_batches"
      ADD CONSTRAINT "pos_bank_reconciliation_batches_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
