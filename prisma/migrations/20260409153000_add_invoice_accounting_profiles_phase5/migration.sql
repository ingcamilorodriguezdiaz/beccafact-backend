CREATE TABLE "invoice_accounting_profiles" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "profileName" TEXT NOT NULL,
  "invoiceType" TEXT NOT NULL,
  "sourceChannel" TEXT,
  "branchId" TEXT,
  "receivableAccountId" TEXT NOT NULL,
  "revenueAccountId" TEXT NOT NULL,
  "taxAccountId" TEXT NOT NULL,
  "withholdingReceivableAccountId" TEXT,
  "withholdingRate" DECIMAL(8,4),
  "icaReceivableAccountId" TEXT,
  "icaRate" DECIMAL(8,4),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_accounting_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_accounting_profiles_companyId_invoiceType_sourceChann_idx"
ON "invoice_accounting_profiles"("companyId","invoiceType","sourceChannel","branchId");

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_receivableAccountId_fkey"
  FOREIGN KEY ("receivableAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_revenueAccountId_fkey"
  FOREIGN KEY ("revenueAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_taxAccountId_fkey"
  FOREIGN KEY ("taxAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_withholdingReceivableAccountId_fkey"
  FOREIGN KEY ("withholdingReceivableAccountId") REFERENCES "accounting_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_accounting_profiles"
  ADD CONSTRAINT "invoice_accounting_profiles_icaReceivableAccountId_fkey"
  FOREIGN KEY ("icaReceivableAccountId") REFERENCES "accounting_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
