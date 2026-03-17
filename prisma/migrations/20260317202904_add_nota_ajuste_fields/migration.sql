-- CreateEnum
CREATE TYPE "DianDocumentType" AS ENUM ('FACTURA_VENTA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'FACTURA_EXPORTACION', 'DOCUMENTO_SOPORTE', 'NOTA_AJUSTE_SOPORTE', 'NOMINA_INDIVIDUAL', 'NOMINA_INDIVIDUAL_AJUSTE');

-- AlterTable
ALTER TABLE "payroll_records" ADD COLUMN     "cuneRef" TEXT,
ADD COLUMN     "fechaGenRef" TEXT,
ADD COLUMN     "payrollNumberRef" TEXT,
ADD COLUMN     "tipoAjuste" TEXT;

-- CreateTable
CREATE TABLE "dian_xml_templates" (
    "id" TEXT NOT NULL,
    "documentType" "DianDocumentType" NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'V1.0:2021',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "xmlTemplate" TEXT NOT NULL,
    "xsdSchemaUrl" TEXT,
    "namespace" TEXT,
    "rootElement" TEXT,
    "hashAlgorithm" TEXT,
    "hashFields" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "dian_xml_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dian_xml_templates_documentType_isActive_idx" ON "dian_xml_templates"("documentType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "dian_xml_templates_documentType_version_key" ON "dian_xml_templates"("documentType", "version");
