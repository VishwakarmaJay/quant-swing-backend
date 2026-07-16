-- CreateEnum
CREATE TYPE "Broker" AS ENUM ('CHAOS');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIAL', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('INTRADAY', 'NORMAL');

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "broker" "Broker" NOT NULL DEFAULT 'CHAOS',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "transactionType" "TransactionType" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "productType" "ProductType" NOT NULL DEFAULT 'INTRADAY',
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "brokerOrderId" TEXT,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "averageExecutionPrice" DOUBLE PRECISION,
    "rejectReason" TEXT,
    "placedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" "Broker" NOT NULL,
    "token" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broker_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_log" (
    "id" TEXT NOT NULL,
    "broker" "Broker" NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER NOT NULL DEFAULT 200,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "brokerOrderId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_userId_status_idx" ON "order"("userId", "status");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE INDEX "order_brokerOrderId_idx" ON "order"("brokerOrderId");

-- CreateIndex
CREATE INDEX "order_createdAt_idx" ON "order"("createdAt");

-- CreateIndex
CREATE INDEX "broker_token_userId_broker_expiry_idx" ON "broker_token"("userId", "broker", "expiry");

-- CreateIndex
CREATE INDEX "broker_log_orderId_idx" ON "broker_log"("orderId");

-- CreateIndex
CREATE INDEX "broker_log_createdAt_idx" ON "broker_log"("createdAt");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_token" ADD CONSTRAINT "broker_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_log" ADD CONSTRAINT "broker_log_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
