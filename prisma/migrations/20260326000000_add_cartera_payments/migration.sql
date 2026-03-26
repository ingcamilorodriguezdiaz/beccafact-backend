-- CreateTable: cartera_payments
-- Stores individual payment records for receivable invoices,
-- enabling partial payment tracking and full payment history.

CREATE TABLE "cartera_payments" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "invoiceId"     TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "amount"        DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference"     TEXT,
    "notes"         TEXT,
    "paymentDate"   TIMESTAMP(3) NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cartera_payments_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "cartera_payments_invoiceId_idx" ON "cartera_payments"("invoiceId");
CREATE INDEX "cartera_payments_companyId_paymentDate_idx" ON "cartera_payments"("companyId", "paymentDate");

-- Foreign Keys
ALTER TABLE "cartera_payments" ADD CONSTRAINT "cartera_payments_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cartera_payments" ADD CONSTRAINT "cartera_payments_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cartera_payments" ADD CONSTRAINT "cartera_payments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
