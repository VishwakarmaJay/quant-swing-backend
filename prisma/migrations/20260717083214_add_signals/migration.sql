-- CreateTable
CREATE TABLE "signal_run" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOf" DATE NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "regimeDetail" TEXT NOT NULL,
    "approvedCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "weightsVersion" TEXT NOT NULL,
    "factorConfigChecksum" TEXT NOT NULL,

    CONSTRAINT "signal_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOf" DATE NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sector" TEXT,
    "action" TEXT NOT NULL DEFAULT 'BUY',
    "entry" DOUBLE PRECISION NOT NULL,
    "entryLow" DOUBLE PRECISION NOT NULL,
    "entryHigh" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "target1" DOUBLE PRECISION NOT NULL,
    "target2" DOUBLE PRECISION NOT NULL,
    "riskPerShare" DOUBLE PRECISION NOT NULL,
    "rrToResistance" DOUBLE PRECISION,
    "atrPct" DOUBLE PRECISION NOT NULL,
    "qty" INTEGER NOT NULL,
    "positionValue" DOUBLE PRECISION NOT NULL,
    "allocatedCapital" DOUBLE PRECISION NOT NULL,
    "riskAmount" DOUBLE PRECISION NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "agreementScore" DOUBLE PRECISION NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "snapshotSchemaVersion" TEXT NOT NULL,
    "weightsVersion" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "instrumentMasterVersion" TEXT NOT NULL,
    "constituentSnapshotDate" DATE NOT NULL,
    "factorConfigChecksum" TEXT NOT NULL,

    CONSTRAINT "signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_rejection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "signal_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_run_createdAt_idx" ON "signal_run"("createdAt");

-- CreateIndex
CREATE INDEX "signal_runId_idx" ON "signal"("runId");

-- CreateIndex
CREATE INDEX "signal_createdAt_idx" ON "signal"("createdAt");

-- CreateIndex
CREATE INDEX "signal_instrumentId_idx" ON "signal"("instrumentId");

-- CreateIndex
CREATE INDEX "signal_rejection_runId_idx" ON "signal_rejection"("runId");

-- CreateIndex
CREATE INDEX "signal_rejection_reason_idx" ON "signal_rejection"("reason");

-- AddForeignKey
ALTER TABLE "signal" ADD CONSTRAINT "signal_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
