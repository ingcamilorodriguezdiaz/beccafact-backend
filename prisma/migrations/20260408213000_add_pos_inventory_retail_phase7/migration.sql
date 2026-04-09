-- CreateEnum
CREATE TYPE "PosInventoryLocationType" AS ENUM ('STORE', 'BACKROOM', 'WAREHOUSE', 'TRANSIT');

-- CreateEnum
CREATE TYPE "PosInventoryReservationStatus" AS ENUM ('OPEN', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PosInventoryTransferStatus" AS ENUM ('PENDING', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "pos_sales" ADD COLUMN     "inventoryLocationId" TEXT;

-- AlterTable
ALTER TABLE "pos_terminals" ADD COLUMN     "defaultInventoryLocationId" TEXT;

-- CreateTable
CREATE TABLE "pos_inventory_locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PosInventoryLocationType" NOT NULL DEFAULT 'STORE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowPosSales" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_stocks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "serialNumber" TEXT,
    "expiresAt" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_inventory_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_reservations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockId" TEXT,
    "saleId" TEXT,
    "sessionId" TEXT,
    "customerId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "PosInventoryReservationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_allocations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_inventory_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromBranchId" TEXT,
    "toBranchId" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PosInventoryTransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_transfer_items" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lotNumber" TEXT,
    "serialNumber" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_inventory_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_inventory_locations_companyId_branchId_isActive_idx" ON "pos_inventory_locations"("companyId", "branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "pos_inventory_locations_companyId_code_key" ON "pos_inventory_locations"("companyId", "code");

-- CreateIndex
CREATE INDEX "pos_inventory_stocks_companyId_branchId_productId_idx" ON "pos_inventory_stocks"("companyId", "branchId", "productId");

-- CreateIndex
CREATE INDEX "pos_inventory_stocks_locationId_productId_idx" ON "pos_inventory_stocks"("locationId", "productId");

-- CreateIndex
CREATE INDEX "pos_inventory_stocks_serialNumber_idx" ON "pos_inventory_stocks"("serialNumber");

-- CreateIndex
CREATE INDEX "pos_inventory_reservations_companyId_branchId_status_idx" ON "pos_inventory_reservations"("companyId", "branchId", "status");

-- CreateIndex
CREATE INDEX "pos_inventory_reservations_saleId_idx" ON "pos_inventory_reservations"("saleId");

-- CreateIndex
CREATE INDEX "pos_inventory_allocations_saleItemId_idx" ON "pos_inventory_allocations"("saleItemId");

-- CreateIndex
CREATE INDEX "pos_inventory_allocations_stockId_idx" ON "pos_inventory_allocations"("stockId");

-- CreateIndex
CREATE INDEX "pos_inventory_transfers_companyId_status_createdAt_idx" ON "pos_inventory_transfers"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_inventory_transfers_companyId_reference_key" ON "pos_inventory_transfers"("companyId", "reference");

-- CreateIndex
CREATE INDEX "pos_inventory_transfer_items_transferId_idx" ON "pos_inventory_transfer_items"("transferId");

-- CreateIndex
CREATE INDEX "pos_sales_inventoryLocationId_idx" ON "pos_sales"("inventoryLocationId");

-- CreateIndex
CREATE INDEX "pos_terminals_defaultInventoryLocationId_idx" ON "pos_terminals"("defaultInventoryLocationId");

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_defaultInventoryLocationId_fkey" FOREIGN KEY ("defaultInventoryLocationId") REFERENCES "pos_inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "pos_inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_locations" ADD CONSTRAINT "pos_inventory_locations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_locations" ADD CONSTRAINT "pos_inventory_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "pos_inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "pos_inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_reservations" ADD CONSTRAINT "pos_inventory_reservations_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "pos_inventory_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_allocations" ADD CONSTRAINT "pos_inventory_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_allocations" ADD CONSTRAINT "pos_inventory_allocations_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "pos_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_allocations" ADD CONSTRAINT "pos_inventory_allocations_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "pos_inventory_stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "pos_inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfers" ADD CONSTRAINT "pos_inventory_transfers_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "pos_inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfer_items" ADD CONSTRAINT "pos_inventory_transfer_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfer_items" ADD CONSTRAINT "pos_inventory_transfer_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfer_items" ADD CONSTRAINT "pos_inventory_transfer_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_inventory_transfer_items" ADD CONSTRAINT "pos_inventory_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "pos_inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

