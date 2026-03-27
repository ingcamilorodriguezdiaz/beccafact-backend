-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "cityCode" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'CO',
ADD COLUMN     "departmentCode" TEXT;
