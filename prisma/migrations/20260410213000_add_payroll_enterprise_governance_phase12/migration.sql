CREATE TABLE "payroll_enterprise_rules" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "processArea" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "policyName" TEXT NOT NULL,
  "allowedRoles" JSONB,
  "requireDifferentActors" BOOLEAN NOT NULL DEFAULT false,
  "requireBranchScope" BOOLEAN NOT NULL DEFAULT false,
  "requireAccountingReview" BOOLEAN NOT NULL DEFAULT false,
  "sharedWithAreas" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_enterprise_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_enterprise_rules_companyId_processArea_actionType_isA_idx"
  ON "payroll_enterprise_rules"("companyId", "processArea", "actionType", "isActive");
CREATE INDEX "payroll_enterprise_rules_branchId_idx"
  ON "payroll_enterprise_rules"("branchId");

ALTER TABLE "payroll_enterprise_rules"
  ADD CONSTRAINT "payroll_enterprise_rules_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_enterprise_rules"
  ADD CONSTRAINT "payroll_enterprise_rules_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
