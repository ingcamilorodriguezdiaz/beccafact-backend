-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "posClaveTecnica" TEXT,
ADD COLUMN     "posEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "posSoftwareId" TEXT,
ADD COLUMN     "posSoftwarePin" TEXT,
ADD COLUMN     "posTestMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "posTestSetId" TEXT;
