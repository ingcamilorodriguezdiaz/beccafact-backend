ALTER TABLE "quote_approval_requests"
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "policyName" TEXT,
  ADD COLUMN "requiredRole" TEXT,
  ADD COLUMN "thresholdType" TEXT,
  ADD COLUMN "thresholdValue" DECIMAL(14,2);

CREATE TABLE "quote_approval_policies" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "approvalType" TEXT NOT NULL,
  "thresholdValue" DECIMAL(14,2) NOT NULL,
  "requiredRole" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_approval_policies_companyId_name_key" ON "quote_approval_policies"("companyId", "name");
CREATE INDEX "quote_approval_policies_companyId_isActive_sequence_idx" ON "quote_approval_policies"("companyId", "isActive", "sequence");
CREATE INDEX "quote_approval_requests_quoteId_sequence_idx" ON "quote_approval_requests"("quoteId", "sequence");

ALTER TABLE "quote_approval_policies"
  ADD CONSTRAINT "quote_approval_policies_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
