-- CreateTable
CREATE TABLE "instrument" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expiry" DATE,
    "strike" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lotSize" INTEGER NOT NULL DEFAULT 1,
    "tickSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "instrumentType" TEXT NOT NULL,
    "exchSeg" TEXT NOT NULL,
    "freezeQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_master_update" (
    "id" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "stored" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_master_update_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instrument_symbol_idx" ON "instrument"("symbol");

-- CreateIndex
CREATE INDEX "instrument_name_idx" ON "instrument"("name");

-- CreateIndex
CREATE INDEX "instrument_expiry_idx" ON "instrument"("expiry");

-- CreateIndex
CREATE INDEX "instrument_instrumentType_idx" ON "instrument"("instrumentType");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_exchSeg_token_key" ON "instrument"("exchSeg", "token");
