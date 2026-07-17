-- CreateTable
CREATE TABLE "undelivered_alert" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "runId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "undelivered_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "undelivered_alert_deliveredAt_idx" ON "undelivered_alert"("deliveredAt");
