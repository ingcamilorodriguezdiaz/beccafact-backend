-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED');

-- AlterEnum
ALTER TYPE "PosSaleStatus" ADD VALUE 'ADVANCE';

-- AlterTable
ALTER TABLE "pos_sales"
  ADD COLUMN "advanceAmount"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryStatus"  "DeliveryStatus" NOT NULL DEFAULT 'DELIVERED';
