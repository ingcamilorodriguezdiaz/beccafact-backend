ALTER TABLE "pos_sessions"
  ADD COLUMN "offlineSinceAt" TIMESTAMP(3),
  ADD COLUMN "offlineQueueDepth" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "pos_terminals"
  ADD COLUMN "heartbeatSlaSeconds" INTEGER NOT NULL DEFAULT 120;

ALTER TABLE "pos_sales"
  ADD COLUMN "clientSyncId" TEXT;

CREATE UNIQUE INDEX "pos_sales_companyId_clientSyncId_key"
  ON "pos_sales"("companyId", "clientSyncId");

CREATE TABLE "pos_operational_incidents" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "terminalId" TEXT,
  "sessionId" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "meta" JSONB,
  CONSTRAINT "pos_operational_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_config_deployments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "terminalId" TEXT,
  "createdById" TEXT,
  "scope" TEXT NOT NULL,
  "deploymentType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "versionLabel" TEXT,
  "snapshot" JSONB,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_config_deployments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pos_operational_incidents_companyId_status_startedAt_idx"
  ON "pos_operational_incidents"("companyId", "status", "startedAt");
CREATE INDEX "pos_operational_incidents_branchId_idx"
  ON "pos_operational_incidents"("branchId");
CREATE INDEX "pos_operational_incidents_terminalId_idx"
  ON "pos_operational_incidents"("terminalId");
CREATE INDEX "pos_operational_incidents_sessionId_idx"
  ON "pos_operational_incidents"("sessionId");

CREATE INDEX "pos_config_deployments_companyId_createdAt_idx"
  ON "pos_config_deployments"("companyId", "createdAt");
CREATE INDEX "pos_config_deployments_branchId_status_idx"
  ON "pos_config_deployments"("branchId", "status");
CREATE INDEX "pos_config_deployments_terminalId_status_idx"
  ON "pos_config_deployments"("terminalId", "status");

ALTER TABLE "pos_operational_incidents"
  ADD CONSTRAINT "pos_operational_incidents_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_operational_incidents"
  ADD CONSTRAINT "pos_operational_incidents_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_operational_incidents"
  ADD CONSTRAINT "pos_operational_incidents_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_operational_incidents"
  ADD CONSTRAINT "pos_operational_incidents_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_operational_incidents"
  ADD CONSTRAINT "pos_operational_incidents_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_config_deployments"
  ADD CONSTRAINT "pos_config_deployments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_config_deployments"
  ADD CONSTRAINT "pos_config_deployments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_config_deployments"
  ADD CONSTRAINT "pos_config_deployments_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_config_deployments"
  ADD CONSTRAINT "pos_config_deployments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
