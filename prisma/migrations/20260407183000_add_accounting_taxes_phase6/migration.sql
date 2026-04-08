CREATE TABLE "accounting_tax_configs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "taxCode" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "rate" DECIMAL(8,4),
  "accountId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_tax_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_tax_configs_companyId_taxCode_key"
ON "accounting_tax_configs"("companyId", "taxCode");

CREATE INDEX "accounting_tax_configs_companyId_isActive_idx"
ON "accounting_tax_configs"("companyId", "isActive");

CREATE INDEX "accounting_tax_configs_companyId_accountId_idx"
ON "accounting_tax_configs"("companyId", "accountId");

ALTER TABLE "accounting_tax_configs"
ADD CONSTRAINT "accounting_tax_configs_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_tax_configs"
ADD CONSTRAINT "accounting_tax_configs_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
