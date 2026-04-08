CREATE TABLE "quote_versions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_versions_quoteId_versionNumber_key"
  ON "quote_versions"("quoteId", "versionNumber");

CREATE INDEX "quote_versions_companyId_quoteId_idx"
  ON "quote_versions"("companyId", "quoteId");

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "quote_approval_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_approval_requests_companyId_quoteId_idx"
  ON "quote_approval_requests"("companyId", "quoteId");

CREATE INDEX "quote_approval_requests_status_idx"
  ON "quote_approval_requests"("status");

ALTER TABLE "quote_approval_requests"
  ADD CONSTRAINT "quote_approval_requests_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_approval_requests"
  ADD CONSTRAINT "quote_approval_requests_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_approval_requests"
  ADD CONSTRAINT "quote_approval_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_approval_requests"
  ADD CONSTRAINT "quote_approval_requests_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
