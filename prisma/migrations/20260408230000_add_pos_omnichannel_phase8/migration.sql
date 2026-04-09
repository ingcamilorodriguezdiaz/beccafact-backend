-- CreateEnum
CREATE TYPE "PosOrderType" AS ENUM ('IN_STORE', 'PICKUP', 'DELIVERY', 'LAYAWAY', 'PREORDER');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('OPEN', 'READY', 'IN_TRANSIT', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "pos_sales" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryContactName" TEXT,
ADD COLUMN     "deliveryContactPhone" TEXT,
ADD COLUMN     "dispatchNotes" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "isPreOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orderReference" TEXT,
ADD COLUMN     "orderStatus" "PosOrderStatus" NOT NULL DEFAULT 'CLOSED',
ADD COLUMN     "orderType" "PosOrderType" NOT NULL DEFAULT 'IN_STORE',
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "pos_sales_orderType_orderStatus_idx" ON "pos_sales"("orderType", "orderStatus");

