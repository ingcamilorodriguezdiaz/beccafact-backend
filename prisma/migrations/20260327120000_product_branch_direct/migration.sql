-- DropForeignKey
ALTER TABLE "branch_stocks" DROP CONSTRAINT "branch_stocks_branchId_fkey";

-- DropForeignKey
ALTER TABLE "branch_stocks" DROP CONSTRAINT "branch_stocks_companyId_fkey";

-- DropForeignKey
ALTER TABLE "branch_stocks" DROP CONSTRAINT "branch_stocks_productId_fkey";

-- DropIndex
DROP INDEX "products_companyId_sku_key";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "branchId" TEXT;

-- DropTable
DROP TABLE "branch_stocks";

-- CreateIndex
CREATE INDEX "products_companyId_branchId_sku_idx" ON "products"("companyId", "branchId", "sku");

-- CreateIndex
CREATE INDEX "products_branchId_idx" ON "products"("branchId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
