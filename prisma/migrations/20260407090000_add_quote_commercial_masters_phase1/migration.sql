CREATE TABLE "quote_sales_owners" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_sales_owners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_source_channels" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_source_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_lost_reasons" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_lost_reasons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_stages" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "color" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_price_lists" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_price_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_price_list_items" (
  "id" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_templates" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "notes" TEXT,
  "terms" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_template_items" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
  "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_template_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_sales_owners_companyId_name_key" ON "quote_sales_owners"("companyId", "name");
CREATE INDEX "quote_sales_owners_companyId_isActive_idx" ON "quote_sales_owners"("companyId", "isActive");

CREATE UNIQUE INDEX "quote_source_channels_companyId_name_key" ON "quote_source_channels"("companyId", "name");
CREATE INDEX "quote_source_channels_companyId_isActive_idx" ON "quote_source_channels"("companyId", "isActive");

CREATE UNIQUE INDEX "quote_lost_reasons_companyId_name_key" ON "quote_lost_reasons"("companyId", "name");
CREATE INDEX "quote_lost_reasons_companyId_isActive_idx" ON "quote_lost_reasons"("companyId", "isActive");

CREATE UNIQUE INDEX "quote_stages_companyId_name_key" ON "quote_stages"("companyId", "name");
CREATE INDEX "quote_stages_companyId_isActive_position_idx" ON "quote_stages"("companyId", "isActive", "position");

CREATE UNIQUE INDEX "quote_price_lists_companyId_name_key" ON "quote_price_lists"("companyId", "name");
CREATE INDEX "quote_price_lists_companyId_isActive_idx" ON "quote_price_lists"("companyId", "isActive");

CREATE INDEX "quote_price_list_items_priceListId_position_idx" ON "quote_price_list_items"("priceListId", "position");

CREATE UNIQUE INDEX "quote_templates_companyId_name_key" ON "quote_templates"("companyId", "name");
CREATE INDEX "quote_templates_companyId_isActive_idx" ON "quote_templates"("companyId", "isActive");

CREATE INDEX "quote_template_items_templateId_position_idx" ON "quote_template_items"("templateId", "position");

ALTER TABLE "quote_sales_owners"
  ADD CONSTRAINT "quote_sales_owners_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_source_channels"
  ADD CONSTRAINT "quote_source_channels_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_lost_reasons"
  ADD CONSTRAINT "quote_lost_reasons_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_stages"
  ADD CONSTRAINT "quote_stages_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_price_lists"
  ADD CONSTRAINT "quote_price_lists_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_price_list_items"
  ADD CONSTRAINT "quote_price_list_items_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "quote_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_price_list_items"
  ADD CONSTRAINT "quote_price_list_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_templates"
  ADD CONSTRAINT "quote_templates_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_template_items"
  ADD CONSTRAINT "quote_template_items_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "quote_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_template_items"
  ADD CONSTRAINT "quote_template_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
