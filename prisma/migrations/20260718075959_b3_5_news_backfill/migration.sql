-- B3.5 — Historical News Backfill: availability timestamp + provenance.
--
-- Every existing row was captured LIVE by the B3 collector, so its honest
-- availability moment IS its fetchedAt (the as-of discipline B3 was built on).
-- Origin is derived from the source: BSE_ANNOUNCEMENTS came through the BSE
-- announcements API, everything else through RSS/Atom polls. Columns are added
-- nullable, backfilled, then locked NOT NULL — no default value, so every
-- future writer must state availability/provenance explicitly.

-- CreateEnum
CREATE TYPE "NewsOrigin" AS ENUM ('LIVE_RSS', 'LIVE_BSE', 'GDELT');

-- AlterTable (nullable first; see backfill below)
ALTER TABLE "news_article" ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "origin" "NewsOrigin";

-- Backfill existing live-captured rows
UPDATE "news_article"
SET "availableAt" = "fetchedAt",
    "origin" = CASE WHEN "source" = 'BSE_ANNOUNCEMENTS'
                    THEN 'LIVE_BSE'::"NewsOrigin"
                    ELSE 'LIVE_RSS'::"NewsOrigin"
               END;

-- Lock NOT NULL
ALTER TABLE "news_article" ALTER COLUMN "availableAt" SET NOT NULL,
ALTER COLUMN "origin" SET NOT NULL;

-- CreateIndex
CREATE INDEX "news_article_availableAt_idx" ON "news_article"("availableAt");
