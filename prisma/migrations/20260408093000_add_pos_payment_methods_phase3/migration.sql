ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'DATAPHONE';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'WALLET';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'VOUCHER';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'GIFT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'AGREEMENT';

CREATE TABLE IF NOT EXISTS "pos_sale_payments" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionReference" TEXT,
  "providerName" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_sale_payments_saleId_paymentMethod_idx"
ON "pos_sale_payments"("saleId", "paymentMethod");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'pos_sale_payments_saleId_fkey'
      AND table_name = 'pos_sale_payments'
  ) THEN
    ALTER TABLE "pos_sale_payments"
    ADD CONSTRAINT "pos_sale_payments_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
