CREATE TYPE "PurchaseBudgetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

CREATE TABLE "purchase_budgets" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "PurchaseBudgetStatus" NOT NULL DEFAULT 'DRAFT',
  "amount" DECIMAL(14,2) NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "area" TEXT,
  "costCenter" TEXT,
  "projectCode" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "purchase_budgets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_requests"
  ADD COLUMN "budgetId" TEXT,
  ADD COLUMN "requestingArea" TEXT,
  ADD COLUMN "costCenter" TEXT,
  ADD COLUMN "projectCode" TEXT;

ALTER TABLE "purchase_orders"
  ADD COLUMN "budgetId" TEXT,
  ADD COLUMN "requestingArea" TEXT,
  ADD COLUMN "costCenter" TEXT,
  ADD COLUMN "projectCode" TEXT;

CREATE UNIQUE INDEX "purchase_budgets_companyId_number_key" ON "purchase_budgets"("companyId", "number");
CREATE INDEX "purchase_budgets_companyId_status_idx" ON "purchase_budgets"("companyId", "status");
CREATE INDEX "purchase_budgets_startDate_endDate_idx" ON "purchase_budgets"("startDate", "endDate");
CREATE INDEX "purchase_requests_budgetId_idx" ON "purchase_requests"("budgetId");
CREATE INDEX "purchase_orders_budgetId_idx" ON "purchase_orders"("budgetId");

ALTER TABLE "purchase_budgets"
  ADD CONSTRAINT "purchase_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requests"
  ADD CONSTRAINT "purchase_requests_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "purchase_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "purchase_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
