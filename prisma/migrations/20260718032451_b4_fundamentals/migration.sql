-- CreateTable
CREATE TABLE "quarterly_fundamental" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "periodEnd" DATE NOT NULL,
    "epsBasic" DOUBLE PRECISION NOT NULL,
    "netProfit" DOUBLE PRECISION,
    "sales" DOUBLE PRECISION,
    "announcedAt" TIMESTAMP(3),
    "fallbackAvailableAt" DATE NOT NULL,
    "basis" TEXT NOT NULL,
    "bseScripCode" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quarterly_fundamental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundamental_snapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "pe" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "bookValue" DOUBLE PRECISION,
    "roePct" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundamental_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quarterly_fundamental_symbol_announcedAt_idx" ON "quarterly_fundamental"("symbol", "announcedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quarterly_fundamental_symbol_periodEnd_key" ON "quarterly_fundamental"("symbol", "periodEnd");

-- CreateIndex
CREATE INDEX "fundamental_snapshot_symbol_fetchedAt_idx" ON "fundamental_snapshot"("symbol", "fetchedAt");
