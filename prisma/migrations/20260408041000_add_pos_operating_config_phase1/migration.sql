-- CreateTable
CREATE TABLE "pos_terminals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cashRegisterName" TEXT,
    "deviceName" TEXT,
    "printerName" TEXT,
    "printerConnectionType" TEXT,
    "printerPaperWidth" INTEGER NOT NULL DEFAULT 80,
    "invoicePrefix" TEXT DEFAULT 'POS',
    "receiptPrefix" TEXT DEFAULT 'TIR',
    "resolutionNumber" TEXT,
    "resolutionLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT true,
    "autoPrintInvoice" BOOLEAN NOT NULL DEFAULT false,
    "requireCustomerForInvoice" BOOLEAN NOT NULL DEFAULT true,
    "allowOpenDrawer" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shift_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "toleranceMinutes" INTEGER NOT NULL DEFAULT 0,
    "requiresBlindClose" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_shift_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "pos_sessions"
ADD COLUMN "terminalId" TEXT,
ADD COLUMN "shiftTemplateId" TEXT,
ADD COLUMN "openingSnapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_companyId_code_key" ON "pos_terminals"("companyId", "code");

-- CreateIndex
CREATE INDEX "pos_terminals_companyId_branchId_isActive_idx" ON "pos_terminals"("companyId", "branchId", "isActive");

-- CreateIndex
CREATE INDEX "pos_shift_templates_companyId_branchId_isActive_idx" ON "pos_shift_templates"("companyId", "branchId", "isActive");

-- CreateIndex
CREATE INDEX "pos_sessions_terminalId_idx" ON "pos_sessions"("terminalId");

-- CreateIndex
CREATE INDEX "pos_sessions_shiftTemplateId_idx" ON "pos_sessions"("shiftTemplateId");

-- AddForeignKey
ALTER TABLE "pos_terminals"
ADD CONSTRAINT "pos_terminals_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals"
ADD CONSTRAINT "pos_terminals_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shift_templates"
ADD CONSTRAINT "pos_shift_templates_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shift_templates"
ADD CONSTRAINT "pos_shift_templates_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions"
ADD CONSTRAINT "pos_sessions_terminalId_fkey"
FOREIGN KEY ("terminalId") REFERENCES "pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions"
ADD CONSTRAINT "pos_sessions_shiftTemplateId_fkey"
FOREIGN KEY ("shiftTemplateId") REFERENCES "pos_shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
