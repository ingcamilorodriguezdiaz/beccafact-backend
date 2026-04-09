DO $$ BEGIN
  CREATE TYPE "PosPromotionType" AS ENUM ('PRODUCT', 'CUSTOMER', 'ORDER', 'VOLUME', 'SCHEDULE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PosDiscountMode" AS ENUM ('PERCENT', 'FIXED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "pos_terminals"
  ADD COLUMN IF NOT EXISTS "defaultPriceListId" TEXT;

ALTER TABLE "pos_sales"
  ADD COLUMN IF NOT EXISTS "priceListId" TEXT,
  ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB;

CREATE TABLE IF NOT EXISTS "pos_price_lists" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_price_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_price_list_items" (
  "id" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "minQuantity" DECIMAL(12,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_promotions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT,
  "productId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" "PosPromotionType" NOT NULL,
  "discountMode" "PosDiscountMode" NOT NULL DEFAULT 'PERCENT',
  "discountValue" DECIMAL(12,2) NOT NULL,
  "minQuantity" DECIMAL(12,4),
  "minSubtotal" DECIMAL(12,2),
  "daysOfWeek" JSONB,
  "startTime" TEXT,
  "endTime" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "priority" INTEGER NOT NULL DEFAULT 0,
  "stackable" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_combos" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "comboPrice" DECIMAL(12,2) NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_combos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_combo_items" (
  "id" TEXT NOT NULL,
  "comboId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
  CONSTRAINT "pos_combo_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_price_lists_companyId_branchId_isActive_idx" ON "pos_price_lists"("companyId", "branchId", "isActive");
CREATE INDEX IF NOT EXISTS "pos_price_list_items_priceListId_productId_idx" ON "pos_price_list_items"("priceListId", "productId");
CREATE INDEX IF NOT EXISTS "pos_promotions_companyId_branchId_isActive_idx" ON "pos_promotions"("companyId", "branchId", "isActive");
CREATE INDEX IF NOT EXISTS "pos_promotions_productId_idx" ON "pos_promotions"("productId");
CREATE INDEX IF NOT EXISTS "pos_promotions_customerId_idx" ON "pos_promotions"("customerId");
CREATE INDEX IF NOT EXISTS "pos_combos_companyId_branchId_isActive_idx" ON "pos_combos"("companyId", "branchId", "isActive");
CREATE INDEX IF NOT EXISTS "pos_combo_items_comboId_productId_idx" ON "pos_combo_items"("comboId", "productId");
CREATE INDEX IF NOT EXISTS "pos_terminals_defaultPriceListId_idx" ON "pos_terminals"("defaultPriceListId");
CREATE INDEX IF NOT EXISTS "pos_sales_priceListId_idx" ON "pos_sales"("priceListId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_price_lists_companyId_fkey') THEN
    ALTER TABLE "pos_price_lists" ADD CONSTRAINT "pos_price_lists_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_price_lists_branchId_fkey') THEN
    ALTER TABLE "pos_price_lists" ADD CONSTRAINT "pos_price_lists_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_price_list_items_priceListId_fkey') THEN
    ALTER TABLE "pos_price_list_items" ADD CONSTRAINT "pos_price_list_items_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "pos_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_price_list_items_productId_fkey') THEN
    ALTER TABLE "pos_price_list_items" ADD CONSTRAINT "pos_price_list_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_promotions_companyId_fkey') THEN
    ALTER TABLE "pos_promotions" ADD CONSTRAINT "pos_promotions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_promotions_branchId_fkey') THEN
    ALTER TABLE "pos_promotions" ADD CONSTRAINT "pos_promotions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_promotions_customerId_fkey') THEN
    ALTER TABLE "pos_promotions" ADD CONSTRAINT "pos_promotions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_promotions_productId_fkey') THEN
    ALTER TABLE "pos_promotions" ADD CONSTRAINT "pos_promotions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_combos_companyId_fkey') THEN
    ALTER TABLE "pos_combos" ADD CONSTRAINT "pos_combos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_combos_branchId_fkey') THEN
    ALTER TABLE "pos_combos" ADD CONSTRAINT "pos_combos_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_combo_items_comboId_fkey') THEN
    ALTER TABLE "pos_combo_items" ADD CONSTRAINT "pos_combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "pos_combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_combo_items_productId_fkey') THEN
    ALTER TABLE "pos_combo_items" ADD CONSTRAINT "pos_combo_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_terminals_defaultPriceListId_fkey') THEN
    ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "pos_price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pos_sales_priceListId_fkey') THEN
    ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "pos_price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
