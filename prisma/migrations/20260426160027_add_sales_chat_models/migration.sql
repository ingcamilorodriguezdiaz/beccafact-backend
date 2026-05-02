-- CreateEnum
CREATE TYPE "SalesConversationSource" AS ENUM ('WEB_CHAT', 'WHATSAPP', 'PLAN_CLICK');

-- CreateEnum
CREATE TYPE "SalesConversationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'QUALIFIED', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONVERTED', 'HUMAN_REQUIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SalesMessageSender" AS ENUM ('VISITOR', 'AGENT', 'SYSTEM', 'HUMAN');

-- CreateEnum
CREATE TYPE "SalesBillingPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SIMULATED', 'MERCADO_PAGO', 'WOMPI', 'PAYU');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "sales_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "billingPeriod" "SalesBillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "maxUsers" INTEGER,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_conversations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "customerId" TEXT,
    "quoteId" TEXT,
    "visitorName" TEXT,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" "SalesConversationSource" NOT NULL DEFAULT 'WEB_CHAT',
    "status" "SalesConversationStatus" NOT NULL DEFAULT 'NEW',
    "interestedPlanName" TEXT,
    "recommendedPlanName" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "SalesMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "quoteId" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'SIMULATED',
    "providerReference" TEXT,
    "paymentUrl" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_plans_name_key" ON "sales_plans"("name");

-- CreateIndex
CREATE INDEX "sales_conversations_status_idx" ON "sales_conversations"("status");

-- CreateIndex
CREATE INDEX "sales_conversations_email_idx" ON "sales_conversations"("email");

-- CreateIndex
CREATE INDEX "sales_messages_conversationId_idx" ON "sales_messages"("conversationId");

-- CreateIndex
CREATE INDEX "payment_intents_conversationId_idx" ON "payment_intents"("conversationId");

-- CreateIndex
CREATE INDEX "payment_intents_status_idx" ON "payment_intents"("status");

-- AddForeignKey
ALTER TABLE "sales_messages" ADD CONSTRAINT "sales_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
