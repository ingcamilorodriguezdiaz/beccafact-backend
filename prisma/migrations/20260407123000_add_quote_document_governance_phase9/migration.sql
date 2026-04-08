CREATE TABLE "quote_attachments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "mimeType" TEXT,
  "category" TEXT,
  "notes" TEXT,
  "sizeBytes" INTEGER,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_comments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "commentType" TEXT NOT NULL DEFAULT 'INTERNAL',
  "message" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_attachments_companyId_quoteId_createdAt_idx"
  ON "quote_attachments"("companyId", "quoteId", "createdAt");

CREATE INDEX "quote_comments_companyId_quoteId_createdAt_idx"
  ON "quote_comments"("companyId", "quoteId", "createdAt");

ALTER TABLE "quote_attachments"
  ADD CONSTRAINT "quote_attachments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_attachments"
  ADD CONSTRAINT "quote_attachments_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_attachments"
  ADD CONSTRAINT "quote_attachments_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_comments"
  ADD CONSTRAINT "quote_comments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_comments"
  ADD CONSTRAINT "quote_comments_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_comments"
  ADD CONSTRAINT "quote_comments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
