DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosLoyaltyTransactionType') THEN
    CREATE TYPE "PosLoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'ADJUSTMENT');
  END IF;
END $$;

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "loyaltyCode" TEXT,
  ADD COLUMN IF NOT EXISTS "membershipTier" TEXT,
  ADD COLUMN IF NOT EXISTS "customerSegment" TEXT,
  ADD COLUMN IF NOT EXISTS "loyaltyPointsBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loyaltyPointsEarned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastPurchaseAt" TIMESTAMP(3);

ALTER TABLE "pos_sales"
  ADD COLUMN IF NOT EXISTS "loyaltyCampaignId" TEXT,
  ADD COLUMN IF NOT EXISTS "loyaltyPointsEarned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "pos_loyalty_campaigns" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "targetSegment" TEXT,
  "targetTier" TEXT,
  "minSubtotal" DECIMAL(12,2),
  "pointsPerAmount" DECIMAL(12,4) NOT NULL DEFAULT 0.1,
  "amountStep" DECIMAL(12,2) NOT NULL DEFAULT 10000,
  "bonusPoints" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_loyalty_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pos_loyalty_transactions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "saleId" TEXT,
  "loyaltyCampaignId" TEXT,
  "type" "PosLoyaltyTransactionType" NOT NULL,
  "points" INTEGER NOT NULL,
  "amountBase" DECIMAL(12,2),
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_loyalty_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_loyalty_campaigns_companyId_isActive_idx"
  ON "pos_loyalty_campaigns"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "pos_loyalty_campaigns_branchId_idx"
  ON "pos_loyalty_campaigns"("branchId");
CREATE INDEX IF NOT EXISTS "pos_loyalty_transactions_companyId_customerId_createdAt_idx"
  ON "pos_loyalty_transactions"("companyId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "pos_loyalty_transactions_saleId_idx"
  ON "pos_loyalty_transactions"("saleId");
CREATE INDEX IF NOT EXISTS "pos_sales_loyaltyCampaignId_idx"
  ON "pos_sales"("loyaltyCampaignId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_campaigns_companyId_fkey') THEN
    ALTER TABLE "pos_loyalty_campaigns"
      ADD CONSTRAINT "pos_loyalty_campaigns_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_campaigns_branchId_fkey') THEN
    ALTER TABLE "pos_loyalty_campaigns"
      ADD CONSTRAINT "pos_loyalty_campaigns_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_campaigns_customerId_fkey') THEN
    ALTER TABLE "pos_loyalty_campaigns"
      ADD CONSTRAINT "pos_loyalty_campaigns_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_transactions_companyId_fkey') THEN
    ALTER TABLE "pos_loyalty_transactions"
      ADD CONSTRAINT "pos_loyalty_transactions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_transactions_customerId_fkey') THEN
    ALTER TABLE "pos_loyalty_transactions"
      ADD CONSTRAINT "pos_loyalty_transactions_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_transactions_saleId_fkey') THEN
    ALTER TABLE "pos_loyalty_transactions"
      ADD CONSTRAINT "pos_loyalty_transactions_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_loyalty_transactions_loyaltyCampaignId_fkey') THEN
    ALTER TABLE "pos_loyalty_transactions"
      ADD CONSTRAINT "pos_loyalty_transactions_loyaltyCampaignId_fkey"
      FOREIGN KEY ("loyaltyCampaignId") REFERENCES "pos_loyalty_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_loyaltyCampaignId_fkey') THEN
    ALTER TABLE "pos_sales"
      ADD CONSTRAINT "pos_sales_loyaltyCampaignId_fkey"
      FOREIGN KEY ("loyaltyCampaignId") REFERENCES "pos_loyalty_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
