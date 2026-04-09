-- AlterEnum
ALTER TYPE "PosSessionStatus" ADD VALUE IF NOT EXISTS 'PENDING_CLOSE_APPROVAL';

-- AlterTable
ALTER TABLE "pos_sessions"
ADD COLUMN "countedCash" DECIMAL(12,2),
ADD COLUMN "openingDenominations" JSONB,
ADD COLUMN "closingDenominations" JSONB,
ADD COLUMN "closeRequestedAt" TIMESTAMP(3),
ADD COLUMN "closeRequestedById" TEXT,
ADD COLUMN "closeApprovedAt" TIMESTAMP(3),
ADD COLUMN "closeApprovedById" TEXT,
ADD COLUMN "closeRejectedAt" TIMESTAMP(3),
ADD COLUMN "closeRejectedReason" TEXT,
ADD COLUMN "reopenedFromSessionId" TEXT,
ADD COLUMN "reopenedAt" TIMESTAMP(3),
ADD COLUMN "reopenedById" TEXT;

-- CreateIndex
CREATE INDEX "pos_sessions_closeRequestedById_idx" ON "pos_sessions"("closeRequestedById");
CREATE INDEX "pos_sessions_closeApprovedById_idx" ON "pos_sessions"("closeApprovedById");

-- AddForeignKey
ALTER TABLE "pos_sessions"
ADD CONSTRAINT "pos_sessions_closeRequestedById_fkey"
FOREIGN KEY ("closeRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_sessions"
ADD CONSTRAINT "pos_sessions_closeApprovedById_fkey"
FOREIGN KEY ("closeApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_sessions"
ADD CONSTRAINT "pos_sessions_reopenedById_fkey"
FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
