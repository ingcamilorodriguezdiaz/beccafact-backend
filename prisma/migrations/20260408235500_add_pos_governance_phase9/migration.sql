CREATE TYPE "PosGovernanceAction" AS ENUM (
  'MANUAL_DISCOUNT',
  'CASH_WITHDRAWAL',
  'CANCEL_SALE',
  'REFUND_SALE',
  'REOPEN_SESSION',
  'APPROVE_POST_SALE'
);

CREATE TYPE "PosSupervisorOverrideStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CONSUMED'
);

CREATE TABLE "pos_governance_rules" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "action" "PosGovernanceAction" NOT NULL,
  "allowedRoles" JSONB,
  "requiresSupervisorOverride" BOOLEAN NOT NULL DEFAULT false,
  "maxDiscountPct" DECIMAL(5,2),
  "maxAmountThreshold" DECIMAL(12,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_governance_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_supervisor_overrides" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "action" "PosGovernanceAction" NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "status" "PosSupervisorOverrideStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "requestedPayload" JSONB,
  "decisionNotes" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_supervisor_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pos_governance_rules_companyId_branchId_action_isActive_idx"
  ON "pos_governance_rules"("companyId", "branchId", "action", "isActive");

CREATE INDEX "pos_supervisor_overrides_companyId_branchId_status_createdAt_idx"
  ON "pos_supervisor_overrides"("companyId", "branchId", "status", "createdAt");

CREATE INDEX "pos_supervisor_overrides_action_resourceType_resourceId_idx"
  ON "pos_supervisor_overrides"("action", "resourceType", "resourceId");

ALTER TABLE "pos_governance_rules"
  ADD CONSTRAINT "pos_governance_rules_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_governance_rules"
  ADD CONSTRAINT "pos_governance_rules_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_supervisor_overrides"
  ADD CONSTRAINT "pos_supervisor_overrides_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_supervisor_overrides"
  ADD CONSTRAINT "pos_supervisor_overrides_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_supervisor_overrides"
  ADD CONSTRAINT "pos_supervisor_overrides_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_supervisor_overrides"
  ADD CONSTRAINT "pos_supervisor_overrides_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
