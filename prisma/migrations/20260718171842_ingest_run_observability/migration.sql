-- CreateTable
CREATE TABLE "ingest_run" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "perSource" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "alerts" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingest_run_module_startedAt_idx" ON "ingest_run"("module", "startedAt");
