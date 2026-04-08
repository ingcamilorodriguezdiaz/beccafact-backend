ALTER TABLE "journal_entries"
ADD COLUMN "reversedById" TEXT;

CREATE TABLE "journal_entry_approval_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_entry_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_entry_attachments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_entry_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_entries_reversedById_idx"
ON "journal_entries"("reversedById");

CREATE INDEX "journal_entry_approval_requests_companyId_entryId_status_idx"
ON "journal_entry_approval_requests"("companyId","entryId","status");

CREATE INDEX "journal_entry_attachments_companyId_entryId_idx"
ON "journal_entry_attachments"("companyId","entryId");

ALTER TABLE "journal_entries"
ADD CONSTRAINT "journal_entries_reversedById_fkey"
FOREIGN KEY ("reversedById") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_approval_requests"
ADD CONSTRAINT "journal_entry_approval_requests_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entry_approval_requests"
ADD CONSTRAINT "journal_entry_approval_requests_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journal_entry_approval_requests"
ADD CONSTRAINT "journal_entry_approval_requests_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_approval_requests"
ADD CONSTRAINT "journal_entry_approval_requests_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_attachments"
ADD CONSTRAINT "journal_entry_attachments_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entry_attachments"
ADD CONSTRAINT "journal_entry_attachments_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journal_entry_attachments"
ADD CONSTRAINT "journal_entry_attachments_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
