CREATE TABLE "accounting_bank_accounts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "bankCode" TEXT,
  "accountingAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_bank_movements" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "movementDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "description" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNRECONCILED',
  "reconciledEntryId" TEXT,
  "importedById" TEXT,
  "reconciledById" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_bank_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_bank_accounts_companyId_accountNumber_key"
ON "accounting_bank_accounts"("companyId", "accountNumber");

CREATE INDEX "accounting_bank_accounts_companyId_isActive_idx"
ON "accounting_bank_accounts"("companyId", "isActive");

CREATE INDEX "accounting_bank_accounts_companyId_bankCode_idx"
ON "accounting_bank_accounts"("companyId", "bankCode");

CREATE INDEX "accounting_bank_accounts_companyId_accountingAccountId_idx"
ON "accounting_bank_accounts"("companyId", "accountingAccountId");

CREATE INDEX "accounting_bank_movements_companyId_bankAccountId_status_idx"
ON "accounting_bank_movements"("companyId", "bankAccountId", "status");

CREATE INDEX "accounting_bank_movements_companyId_movementDate_idx"
ON "accounting_bank_movements"("companyId", "movementDate");

CREATE INDEX "accounting_bank_movements_companyId_reconciledEntryId_idx"
ON "accounting_bank_movements"("companyId", "reconciledEntryId");

ALTER TABLE "accounting_bank_accounts"
ADD CONSTRAINT "accounting_bank_accounts_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_bank_accounts"
ADD CONSTRAINT "accounting_bank_accounts_bankCode_fkey"
FOREIGN KEY ("bankCode") REFERENCES "banks"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_bank_accounts"
ADD CONSTRAINT "accounting_bank_accounts_accountingAccountId_fkey"
FOREIGN KEY ("accountingAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_bank_movements"
ADD CONSTRAINT "accounting_bank_movements_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_bank_movements"
ADD CONSTRAINT "accounting_bank_movements_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "accounting_bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
