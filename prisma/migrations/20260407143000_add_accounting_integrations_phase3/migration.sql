CREATE TABLE IF NOT EXISTS "accounting_integrations" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "sourceId" TEXT,
  "entryId" TEXT,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_integrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "accounting_integrations_companyId_module_status_idx"
  ON "accounting_integrations"("companyId", "module", "status");

CREATE INDEX IF NOT EXISTS "accounting_integrations_companyId_resourceType_resourceId_idx"
  ON "accounting_integrations"("companyId", "resourceType", "resourceId");

CREATE INDEX IF NOT EXISTS "accounting_integrations_companyId_createdAt_idx"
  ON "accounting_integrations"("companyId", "createdAt");

ALTER TABLE "accounting_integrations"
  ADD CONSTRAINT "accounting_integrations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
