-- Rename the built-in simulation broker from CHAOS to PAPER.
-- RENAME VALUE updates every stored row and the column default in place,
-- unlike Prisma's default drop-and-recreate diff which fails on live data.
ALTER TYPE "Broker" RENAME VALUE 'CHAOS' TO 'PAPER';

-- Rename the per-session config key inside broker_token.meta to match.
UPDATE "broker_token"
SET "meta" = ("meta" - 'chaosConfig') || jsonb_build_object('paperConfig', "meta" -> 'chaosConfig')
WHERE "meta" ? 'chaosConfig';
