-- CreateTable
CREATE TABLE "ohlcv" (
    "instrumentId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ohlcv_pkey" PRIMARY KEY ("instrumentId","tradeDate")
);

-- CreateIndex
CREATE INDEX "ohlcv_instrumentId_tradeDate_idx" ON "ohlcv"("instrumentId", "tradeDate");

-- AddForeignKey
ALTER TABLE "ohlcv" ADD CONSTRAINT "ohlcv_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
