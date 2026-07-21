-- B16: raw-payload capture index (architecture-review "Bronze layer").
-- Payload bytes live in S3 (raw/<sha>.gz); this table is the queryable index.
CREATE TABLE "raw_capture" (
    "id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "s3Key" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "raw_capture_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "raw_capture_sha_key" ON "raw_capture"("sha");
CREATE INDEX "raw_capture_source_firstSeen_idx" ON "raw_capture"("source", "firstSeen");
