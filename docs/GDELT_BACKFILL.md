# GDELT Historical News Backfill (B3.5)

> **What this is:** the historical archive builder (`src/news/gdelt/`) — it retro-fills
> the B3 news archive from the [GDELT Project](https://www.gdeltproject.org/)'s global
> news index so sentiment research has history *before* the live archive clock started
> (2026-07-18). **It is NOT the SentimentFactor** (that's B7) and it changes no trading
> behaviour: this is data acquisition only.
> **Run:** `bun run news:backfill --from YYYY-MM-DD --to YYYY-MM-DD [--symbols A,B] [--dry-run]`

---

## 1. The design idea in one paragraph

Historical articles become **ordinary `NewsArticle` rows** flowing through the *same*
pipeline as live capture — the same Jaccard dedup, the same curated alias dictionary and
symbol mapper, the same FinBERT scoring sweep — so nothing downstream needs a second code
path. What makes retro-import honest rather than lookahead contamination is two fields:
**`origin`** (provenance — research always knows a GDELT row from a live-captured one)
and **`availableAt`** (a *reconstructed, deliberately conservative* availability moment).
The live archive remains the gold standard; the backfill is a clearly-labelled silver
extension backwards in time.

## 2. `availableAt` semantics — the point-in-time contract

Every `news_article` row now carries `availableAt`: **the moment the platform could have
known the article**. This is THE as-of field all research must read.

| Row kind | `availableAt` | `fetchedAt` | `origin` |
|---|---|---|---|
| Live RSS/Atom poll | `= fetchedAt` (capture moment) | capture moment (unchanged semantics) | `LIVE_RSS` |
| Live BSE announcements API | `= fetchedAt` (capture moment) | capture moment (unchanged semantics) | `LIVE_BSE` |
| GDELT historical import | `= publishedAt + GDELT_LATENCY_MINUTES` (default 30) | **import time** — NOT an as-of date | `GDELT` |

Why the latency margin: we were not running a collector back then, so we must not pretend
an article was actionable the instant it was printed. GDELT's `seendate` (when GDELT's
continuous global crawler first saw the article) is used as `publishedAt` — the closest
honest publication proxy a historical source offers — and `availableAt` adds a
configurable delay standing in for the publish→poll lag the live collector would have had
(live polling is 15-min cadence; 30 min is deliberately conservative). **Never use any
GDELT-row information before its `availableAt`.**

`fetchedAt` keeps its live meaning untouched (existing rows were migrated with
`availableAt = fetchedAt`, exactly what B3 always enforced). On a GDELT row `fetchedAt`
is merely bookkeeping — when the import ran.

## 3. Architecture

```
src/news/gdelt/
  gdeltClient.ts   networking ONLY: DOC API URL construction, HTTP fetch
                   (browser UA + timeout), throttle-response classification
  parser.ts        pure: artlist JSON → GdeltArticle[] → GdeltRecord[]
                   (seendate parsing, title cleanup, availableAt reconstruction)
  download.ts      orchestration: date-range slicing (GDELT_BATCH_DAYS),
                   per-symbol query building FROM THE LIVE ALIAS DICTIONARY,
                   rate limiting + 429 backoff, per-window URL-merge
  backfill.ts      batch persistence: shared Jaccard dedup + shared symbol
                   mapper → createMany(skipDuplicates) into news_article
```

One pass, per window (of `GDELT_BATCH_DAYS` days) over `[--from, --to]`:

```
for each universe symbol (or --symbols):
  query = quoted PRIMARY COMPANY_ALIASES phrase + sourcecountry:IN sourcelang:eng
  DOC API artlist fetch (rate-limited; HTTP 429 → ≥5s backoff, bounded retries)
      │
      ▼
merge window results by URL          # same story matched by several symbol queries
      │
      ▼
parse + reconstruct timestamps       # publishedAt = seendate; availableAt = +latency
      │
      ▼
(source='GDELT', url) identity check # already stored → skip (idempotency, stable id)
      │
      ▼
normalizeTitle → Jaccard dedup       # SAME dedupe.ts code; corpus = archive titles
      │                              # published around the article's own time
      ▼
mapArticleSymbols(title)             # SAME symbolMapper.ts + ALIAS_EXCLUSIONS
      │
      ▼
prisma.newsArticle.createMany(skipDuplicates)   # batch persistence
```

Reused, not reimplemented: `dedupe.ts` (normalization + Jaccard), `symbolMapper.ts` +
`companyAliases.ts` (the alias dictionary drives both the GDELT queries *and* the final
tagging — query buys recall, the mapper keeps its precision rules), and the FinBERT flow
(B6): imported rows are simply unscored articles, picked up by the next ingest-cron
scoring pass or `bun run sentiment:score`.

## 4. Provenance (`NewsOrigin`)

`origin` is a required enum on every row: `LIVE_RSS | LIVE_BSE | GDELT`. The migration
stamped all pre-B3.5 rows from their source (BSE_ANNOUNCEMENTS → LIVE_BSE, the RSS feeds
→ LIVE_RSS). Research can therefore always split live-captured from retro-imported — a
sentiment backtest can (and should) measure whether conclusions hold on the live-only
subset, because the live archive is the stronger evidence.

GDELT rows also use `source = 'GDELT'` (the `NewsArticle.source` string), keeping the
`(source, url)` idempotency key consistent with the live feeds.

## 5. Idempotency

Running the same backfill twice creates **zero** duplicates, by three layers:

1. **Stable identity:** the publisher URL under `(source='GDELT', url)` — existing URLs
   are pre-loaded per range and skipped before any similarity logic (`alreadyStored`).
2. **Similarity:** Jaccard title dedup against archive titles published in the
   range-neighbourhood (± `NEWS_DEDUPE_WINDOW_DAYS`) and titles accepted earlier in the
   run — the live policy transposed to *article time* (a historical article dedupes
   against its contemporaries, not against today's headlines).
3. **DB backstop:** `createMany(skipDuplicates)` on the unique key absorbs races with a
   concurrent live ingest or an interrupted-then-resumed run.

A failed window can simply be re-run with the same arguments.

## 6. Configuration

| Env var | Default | Meaning |
|---|---|---|
| `GDELT_BATCH_DAYS` | 30 | Days per DOC API query window when slicing the range |
| `GDELT_LATENCY_MINUTES` | 30 | Reconstructed availability margin: `availableAt = publishedAt + this` |
| `GDELT_RATE_LIMIT_MS` | 500 | Pacing between consecutive DOC API requests |

⚠️ **Operational reality (live-verified 2026-07-18):** GDELT asks for **≤1 request per
5 seconds** and answers faster pacing with HTTP 429 + a plain-text notice; sustained
bursts extend the penalty for minutes. The client detects 429 and backs off ≥5s with
bounded retries, so the 500 ms default self-corrects — but for long multi-symbol runs
set `GDELT_RATE_LIMIT_MS=5000` and let it run unattended rather than churn through
retries. A window that stays throttled is reported as a **failed query**, never as an
empty result.

## 7. Operational usage

```bash
# Whole universe, first half of 2025 (long run — see rate-limit note above):
bun run news:backfill --from 2025-01-01 --to 2025-06-30

# A few symbols, checking what would happen first:
bun run news:backfill --from 2025-01-01 --to 2025-06-30 --symbols RELIANCE,TCS,INFY --dry-run
bun run news:backfill --from 2025-01-01 --to 2025-06-30 --symbols RELIANCE,TCS,INFY
```

Progress prints one line per window (days processed · downloaded · dupes · already
stored · stored · mapped · unmatched) plus a final summary, an unmatched-headline sample
(the alias-dictionary growth queue, same loop as live), and warnings for truncated (hit
the 250-record API cap → lower `GDELT_BATCH_DAYS`) or failed queries (re-run the range;
idempotent).

Request volume: `⌈days/GDELT_BATCH_DAYS⌉ × symbols` API calls. At the polite 5s pacing a
full-universe (~167-symbol) half-year backfill is ~167 × 6 ≈ 1,000 requests ≈ 1.5 hours.

After a backfill, score the new rows: they are picked up automatically by the next
ingest cron pass, or run `bun run sentiment:score` manually.

## 8. Limitations (honest list)

1. **`availableAt` is reconstructed, not observed.** The latency margin is an assumption
   (configurable, conservative), not a measurement. The live archive's `fetchedAt` remains
   strictly more honest — which is why provenance exists and why B7 research should
   validate on the live-only subset. This is the L2 trade-off from
   [`NEWS_SCRAPER.md`](./NEWS_SCRAPER.md) §9 made explicit and bounded, not silently waved
   away.
2. **`seendate` is GDELT's crawl time, not the true publish time.** For major outlets the
   gap is minutes; for small sites it can be longer. Both errors are in the *conservative*
   direction (later availability) *if* GDELT lagged publication — but a wire story GDELT
   saw before an Indian portal reprinted it can carry an earlier seendate than the reprint.
3. **Coverage ≠ the live feeds' coverage.** GDELT is a web-crawl index: no BSE corporate
   announcements (the live archive's highest-precision source), patchy small-cap and
   regional coverage, and `sourcecountry:IN sourcelang:eng` filtering means
   India-relevant stories in foreign outlets are missed. Article *counts* per stock are
   not comparable across origins — normalize per-origin in any aggregation.
4. **Headlines only, no bodies.** The DOC API returns titles; `body` is null. Symbol
   mapping sees less text than live BSE rows (which get `SLONGNAME` prepended), so recall
   is lower per article. FinBERT scores headlines either way (B6 v1 scope).
5. **250-record cap per query window.** A busy symbol × 30-day window can truncate
   (detected + warned). Mitigation: lower `GDELT_BATCH_DAYS`; the run stays idempotent.
6. **Query recall is bounded by the alias dictionary — primary alias only.** A company is
   searched by its *first* curated alias as a single quoted phrase: GDELT answers
   parenthesized-OR phrase queries with its 429 throttle message even in isolation
   (live-verified 2026-07-18), so secondary aliases ("ril", "sbi", …) are not searched.
   Stories that use only a secondary name or name the company obliquely are missed — the
   same precision-first trade B3 chose, applied to search. (The mapper still matches
   every alias in whatever titles come back.)
7. **GDELT titles are tokenized** (spaces around punctuation). A cleanup pass reattaches
   punctuation deterministically, but stored titles can differ cosmetically from the
   publisher's exact headline — dedup and mapping are punctuation-insensitive, so this is
   cosmetic only.
8. **DOC API coverage starts 2017-01-01**, and the endpoint is free/unofficial — the same
   fragility class as every B3 source (rate policy or format can change without notice).
9. **Free-text relevance noise.** GDELT full-text search can return articles whose
   *title* never mentions the company (match was in the body we don't get). Those rows
   are stored with `symbols = []` (unmatched) — archived but invisible to per-stock
   research; the precision gate stays with the mapper, not the query.

## 9. Where things live

| Piece | File |
|---|---|
| DOC API client (networking only) | `src/news/gdelt/gdeltClient.ts` |
| Payload parsing + timestamp reconstruction | `src/news/gdelt/parser.ts` |
| Range slicing, query building, pacing | `src/news/gdelt/download.ts` |
| Processing core + batch persistence | `src/news/gdelt/backfill.ts` |
| CLI | `src/scripts/runNewsBackfill.ts` (`bun run news:backfill`) |
| Schema (`availableAt`, `origin`) + migration | `prisma/schema.prisma` · `prisma/migrations/…_b3_5_news_backfill/` |
| Env knobs | `GDELT_BATCH_DAYS` · `GDELT_LATENCY_MINUTES` · `GDELT_RATE_LIMIT_MS` |
| Tests | `src/news/gdelt/*.test.ts` |
