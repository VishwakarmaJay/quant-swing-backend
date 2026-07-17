-- AlterTable
ALTER TABLE "instrument" ADD COLUMN     "sector" TEXT;

-- CreateIndex
CREATE INDEX "instrument_sector_idx" ON "instrument"("sector");
