ALTER TABLE "journal_entry_lines"
  ADD COLUMN IF NOT EXISTS "branchId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "costCenter" TEXT,
  ADD COLUMN IF NOT EXISTS "projectCode" TEXT;

CREATE INDEX IF NOT EXISTS "journal_entry_lines_branchId_idx"
  ON "journal_entry_lines"("branchId");

CREATE INDEX IF NOT EXISTS "journal_entry_lines_customerId_idx"
  ON "journal_entry_lines"("customerId");

CREATE INDEX IF NOT EXISTS "journal_entry_lines_costCenter_idx"
  ON "journal_entry_lines"("costCenter");

CREATE INDEX IF NOT EXISTS "journal_entry_lines_projectCode_idx"
  ON "journal_entry_lines"("projectCode");

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
