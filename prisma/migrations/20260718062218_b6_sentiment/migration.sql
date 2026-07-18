-- AlterTable
ALTER TABLE "news_article" ADD COLUMN     "sentimentLabel" TEXT,
ADD COLUMN     "sentimentModel" TEXT,
ADD COLUMN     "sentimentNegative" DOUBLE PRECISION,
ADD COLUMN     "sentimentNeutral" DOUBLE PRECISION,
ADD COLUMN     "sentimentPositive" DOUBLE PRECISION,
ADD COLUMN     "sentimentScore" DOUBLE PRECISION,
ADD COLUMN     "sentimentScoredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "news_article_sentimentScoredAt_idx" ON "news_article"("sentimentScoredAt");
