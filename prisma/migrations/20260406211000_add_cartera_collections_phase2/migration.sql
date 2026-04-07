CREATE TABLE "cartera_payment_promises" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "promisedDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cartera_payment_promises_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cartera_payment_promises_status_check" CHECK ("status" IN ('OPEN', 'FULFILLED', 'BROKEN', 'CANCELLED'))
);

CREATE TABLE "cartera_collection_followups" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "activityType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "nextActionDate" TIMESTAMP(3),
  "nextAction" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cartera_collection_followups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cartera_collection_followups_activityType_check" CHECK ("activityType" IN ('CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'NOTE'))
);

CREATE INDEX "cartera_payment_promises_companyId_promisedDate_idx"
  ON "cartera_payment_promises"("companyId", "promisedDate");

CREATE INDEX "cartera_payment_promises_customerId_idx"
  ON "cartera_payment_promises"("customerId");

CREATE INDEX "cartera_payment_promises_invoiceId_idx"
  ON "cartera_payment_promises"("invoiceId");

CREATE INDEX "cartera_collection_followups_companyId_createdAt_idx"
  ON "cartera_collection_followups"("companyId", "createdAt");

CREATE INDEX "cartera_collection_followups_customerId_idx"
  ON "cartera_collection_followups"("customerId");

CREATE INDEX "cartera_collection_followups_invoiceId_idx"
  ON "cartera_collection_followups"("invoiceId");

ALTER TABLE "cartera_payment_promises"
  ADD CONSTRAINT "cartera_payment_promises_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_payment_promises"
  ADD CONSTRAINT "cartera_payment_promises_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_payment_promises"
  ADD CONSTRAINT "cartera_payment_promises_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_payment_promises"
  ADD CONSTRAINT "cartera_payment_promises_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_collection_followups"
  ADD CONSTRAINT "cartera_collection_followups_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_collection_followups"
  ADD CONSTRAINT "cartera_collection_followups_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_collection_followups"
  ADD CONSTRAINT "cartera_collection_followups_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cartera_collection_followups"
  ADD CONSTRAINT "cartera_collection_followups_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
