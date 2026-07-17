-- CreateTable
CREATE TABLE "news_article" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleNormalized" TEXT NOT NULL,
    "body" TEXT,
    "symbols" TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "news_article_titleNormalized_idx" ON "news_article"("titleNormalized");

-- CreateIndex
CREATE INDEX "news_article_publishedAt_idx" ON "news_article"("publishedAt");

-- CreateIndex
CREATE INDEX "news_article_fetchedAt_idx" ON "news_article"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "news_article_source_url_key" ON "news_article"("source", "url");
