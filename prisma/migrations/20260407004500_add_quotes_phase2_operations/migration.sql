ALTER TABLE "quotes"
  ADD COLUMN "salesOwnerName" TEXT,
  ADD COLUMN "opportunityName" TEXT,
  ADD COLUMN "sourceChannel" TEXT,
  ADD COLUMN "lostReason" TEXT;

CREATE TABLE "quote_followups" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "activityType" TEXT NOT NULL,
  "notes" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_followups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_followups_companyId_quoteId_idx"
  ON "quote_followups"("companyId", "quoteId");

ALTER TABLE "quote_followups"
  ADD CONSTRAINT "quote_followups_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_followups"
  ADD CONSTRAINT "quote_followups_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_followups"
  ADD CONSTRAINT "quote_followups_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
