-- AlterTable: add isSandbox flag to companies
-- Companies with isSandbox=true will NOT transmit any documents to DIAN.
ALTER TABLE "companies" ADD COLUMN "isSandbox" BOOLEAN NOT NULL DEFAULT false;
