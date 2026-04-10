ALTER TABLE "invoices"
  ADD COLUMN "withholdingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "icaAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "fiscalValidationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "fiscalValidationNotes" TEXT;
