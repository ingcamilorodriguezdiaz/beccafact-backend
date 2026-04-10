-- CreateTable
CREATE TABLE "invoice_document_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "posTerminalId" TEXT,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'DIRECT',
    "type" "InvoiceType" NOT NULL DEFAULT 'VENTA',
    "prefix" TEXT NOT NULL,
    "resolutionNumber" TEXT,
    "resolutionLabel" TEXT,
    "rangeFrom" INTEGER,
    "rangeTo" INTEGER,
    "validFrom" TEXT,
    "validTo" TEXT,
    "technicalKey" TEXT,
    "fiscalRules" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_document_configs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "invoices"
ADD COLUMN "sourceChannel" TEXT DEFAULT 'DIRECT',
ADD COLUMN "sourceTerminalId" TEXT,
ADD COLUMN "documentConfigId" TEXT,
ADD COLUMN "resolutionNumber" TEXT,
ADD COLUMN "resolutionLabel" TEXT,
ADD COLUMN "numberingRangeFrom" INTEGER,
ADD COLUMN "numberingRangeTo" INTEGER,
ADD COLUMN "resolutionValidFrom" TEXT,
ADD COLUMN "resolutionValidTo" TEXT,
ADD COLUMN "fiscalRulesSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "invoice_document_configs_companyId_idx" ON "invoice_document_configs"("companyId");
CREATE INDEX "invoice_document_configs_companyId_channel_type_isActive_idx" ON "invoice_document_configs"("companyId", "channel", "type", "isActive");
CREATE INDEX "invoice_document_configs_branchId_idx" ON "invoice_document_configs"("branchId");
CREATE INDEX "invoice_document_configs_posTerminalId_idx" ON "invoice_document_configs"("posTerminalId");
CREATE INDEX "invoices_documentConfigId_idx" ON "invoices"("documentConfigId");

-- AddForeignKey
ALTER TABLE "invoice_document_configs" ADD CONSTRAINT "invoice_document_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_document_configs" ADD CONSTRAINT "invoice_document_configs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_document_configs" ADD CONSTRAINT "invoice_document_configs_posTerminalId_fkey" FOREIGN KEY ("posTerminalId") REFERENCES "pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_documentConfigId_fkey" FOREIGN KEY ("documentConfigId") REFERENCES "invoice_document_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
