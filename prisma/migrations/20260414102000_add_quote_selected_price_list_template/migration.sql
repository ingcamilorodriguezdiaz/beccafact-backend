ALTER TABLE "quotes"
ADD COLUMN "selectedPriceListId" TEXT,
ADD COLUMN "selectedTemplateId" TEXT;

CREATE INDEX "quotes_selectedPriceListId_idx" ON "quotes"("selectedPriceListId");
CREATE INDEX "quotes_selectedTemplateId_idx" ON "quotes"("selectedTemplateId");

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_selectedPriceListId_fkey"
FOREIGN KEY ("selectedPriceListId") REFERENCES "quote_price_lists"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_selectedTemplateId_fkey"
FOREIGN KEY ("selectedTemplateId") REFERENCES "quote_templates"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
