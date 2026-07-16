-- CreateEnum
CREATE TYPE "TradeSetupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'MARKED_FOR_EXIT', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReadableStatus" AS ENUM ('SYNCED', 'NOT_IN_SYNC', 'IN_PROGRESS', 'EXITED');

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "brokerage" DOUBLE PRECISION,
ADD COLUMN     "chase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chaseAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "chaseFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "exchangeCharges" DOUBLE PRECISION,
ADD COLUMN     "gst" DOUBLE PRECISION,
ADD COLUMN     "lastChaseAt" TIMESTAMP(3),
ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "positionLegId" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "sebiCharges" DOUBLE PRECISION,
ADD COLUMN     "stampDuty" DOUBLE PRECISION,
ADD COLUMN     "stt" DOUBLE PRECISION,
ADD COLUMN     "totalCharges" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "trade_setup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TradeSetupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_setup_leg" (
    "id" TEXT NOT NULL,
    "tradeSetupId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "action" "TransactionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_setup_leg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeSetupId" TEXT NOT NULL,
    "broker" "Broker" NOT NULL DEFAULT 'PAPER',
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "userMultiplier" INTEGER NOT NULL DEFAULT 1,
    "readableStatus" "ReadableStatus",
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calcUnrealisedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_leg" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "tradeSetupLegId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "action" "TransactionType" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_leg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_setup_leg_tradeSetupId_idx" ON "trade_setup_leg"("tradeSetupId");

-- CreateIndex
CREATE INDEX "position_userId_status_idx" ON "position"("userId", "status");

-- CreateIndex
CREATE INDEX "position_tradeSetupId_idx" ON "position"("tradeSetupId");

-- CreateIndex
CREATE INDEX "position_leg_positionId_idx" ON "position_leg"("positionId");

-- CreateIndex
CREATE INDEX "order_positionId_idx" ON "order"("positionId");

-- AddForeignKey
ALTER TABLE "trade_setup_leg" ADD CONSTRAINT "trade_setup_leg_tradeSetupId_fkey" FOREIGN KEY ("tradeSetupId") REFERENCES "trade_setup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_setup_leg" ADD CONSTRAINT "trade_setup_leg_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_tradeSetupId_fkey" FOREIGN KEY ("tradeSetupId") REFERENCES "trade_setup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_leg" ADD CONSTRAINT "position_leg_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_leg" ADD CONSTRAINT "position_leg_tradeSetupLegId_fkey" FOREIGN KEY ("tradeSetupLegId") REFERENCES "trade_setup_leg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_leg" ADD CONSTRAINT "position_leg_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_positionLegId_fkey" FOREIGN KEY ("positionLegId") REFERENCES "position_leg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

