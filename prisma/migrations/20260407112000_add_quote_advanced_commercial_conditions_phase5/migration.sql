ALTER TABLE "quotes"
  ADD COLUMN "paymentTermLabel" TEXT,
  ADD COLUMN "paymentTermDays" INTEGER,
  ADD COLUMN "deliveryLeadTimeDays" INTEGER,
  ADD COLUMN "deliveryTerms" TEXT,
  ADD COLUMN "incotermCode" TEXT,
  ADD COLUMN "incotermLocation" TEXT,
  ADD COLUMN "exchangeRate" DECIMAL(12,4) NOT NULL DEFAULT 1,
  ADD COLUMN "commercialConditions" TEXT;
