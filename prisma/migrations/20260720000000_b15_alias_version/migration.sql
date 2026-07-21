-- B15: alias-derivation version stamp on news_article.
-- `symbols[]` is a derived column; this records which dictionary version produced
-- it, so a dictionary change is a tracked bump rather than a silent rewrite.
-- Nullable: existing rows are stamped by a one-time `bun run news:remap` after
-- deploy (they were all last mapped by the current dictionary), and NULL is the
-- honest "unknown / pre-B15" marker until then.
ALTER TABLE "news_article" ADD COLUMN "aliasVersion" TEXT;
