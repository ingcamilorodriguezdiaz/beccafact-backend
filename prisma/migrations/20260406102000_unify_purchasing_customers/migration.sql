ALTER TABLE "purchase_orders" ADD COLUMN "customerId" TEXT;

INSERT INTO "customers" (
  "id",
  "companyId",
  "documentType",
  "documentNumber",
  "name",
  "email",
  "phone",
  "address",
  "city",
  "department",
  "cityCode",
  "departmentCode",
  "country",
  "isActive",
  "creditLimit",
  "creditDays",
  "notes",
  "taxLevelCode",
  "createdAt",
  "updatedAt",
  "deletedAt"
)
SELECT
  s."id",
  s."companyId",
  s."documentType",
  s."documentNumber",
  s."name",
  s."email",
  s."phone",
  s."address",
  s."city",
  s."department",
  s."cityCode",
  s."departmentCode",
  s."country",
  s."isActive",
  s."creditLimit",
  s."paymentTerms",
  s."notes",
  s."taxLevelCode",
  s."createdAt",
  s."updatedAt",
  s."deletedAt"
FROM "suppliers" s
LEFT JOIN "customers" c
  ON c."companyId" = s."companyId"
 AND c."documentType" = s."documentType"
 AND c."documentNumber" = s."documentNumber"
WHERE c."id" IS NULL;

UPDATE "purchase_orders" po
SET "customerId" = c."id"
FROM "suppliers" s
JOIN "customers" c
  ON c."companyId" = s."companyId"
 AND c."documentType" = s."documentType"
 AND c."documentNumber" = s."documentNumber"
WHERE po."supplierId" = s."id";

ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_supplierId_fkey";
DROP INDEX IF EXISTS "suppliers_companyId_idx";
DROP INDEX IF EXISTS "suppliers_companyId_documentType_documentNumber_key";

ALTER TABLE "purchase_orders" DROP COLUMN "supplierId";
ALTER TABLE "purchase_orders" ALTER COLUMN "customerId" SET NOT NULL;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE IF EXISTS "suppliers";
