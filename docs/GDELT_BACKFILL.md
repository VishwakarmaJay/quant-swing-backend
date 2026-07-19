# GDELT Historical News Backfill (B3.5)

> **What this is:** the historical archive builder (`src/news/gdelt/`) — it retro-fills
> the B3 news archive from the [GDELT Project](https://www.gdeltproject.org/)'s global
> news index so sentiment research has history *before* the live archive clock started
> (2026-07-18). **It is NOT the SentimentFactor** (that's B7) and it changes no trading
> behaviour: this is data acquisition only.
>
> **Two acquisition paths, same pipeline:**
> - **GAL bulk (preferred — §7A):** `bun run news:gal:download` (bulk files, no rate limit,
>   ~90 min for 18 months on a workstation) → `bun run news:gal:import`. This is the path
>   actually used to load the archive (≈100k+ Indian-media rows for 2025-01→2026-07).
> - **DOC API (§7B, legacy):** `bun run news:backfill --from … --to …` — throttled and
>   slow; kept for small targeted top-ups only.

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

## 7A. GAL bulk path — the fast, rate-limit-free way (PREFERRED)

The DOC API (§7B) is throttled to ~1 request / 5 s with sticky multi-minute penalties, so
a full-universe media backfill takes *days* and fights the API the whole way. GDELT
publishes the **same article metadata** as bulk files with **no rate limit** — this is the
path that actually built the archive.

**The dataset: GDELT Article List (GAL).** One gzipped NDJSON file per publish tick
(minutes +1..+5 after every quarter-hour) at
`http://data.gdeltproject.org/gdeltv3/gal/YYYYMMDDHHMMSS.gal.json.gz`, each record
`{date, url, domain, title, desc, lang, …}` — *more* than the DOC API gives (adds `desc`,
stored as the article `body`). Coverage from 2020-01-01. Plain HTTP; also on BigQuery as
`gdelt-bq.gdeltv2.gal`, but the file path needs no cloud account.

```bash
# 1. Download + filter on a workstation (bandwidth + CPU; NOT the small VM):
#    sweeps every 15-min file in the range, keeps English titles matching any
#    curated alias, writes compact NDJSON. Checkpointed per quarter-hour.
bun run news:gal:download --from 2025-01-01 --to 2026-07-17 \
  --out .cache/gal-matched.ndjson --state .cache/gal-download-state.json

# 2. Ship the NDJSON to the DB host, then import through the SAME pipeline:
bun run news:gal:import --file gal-matched.ndjson        # [--dry-run]
```

- `downloadGalArchive.ts` — pure network+filesystem (no DB/env). Streams each file
  through gunzip in memory (nothing large hits disk — ~90 MB of matched output for 18
  months), prefilters by `lang=en` + a single combined alias regex, appends matches.
  ~90 min for 18 months on a laptop; resumable (`caffeinate` on a Mac to prevent sleep).
- `importGalArchive.ts` — feeds records into the **same `processGdeltRecords`** core
  (timestamp reconstruction, dedup, symbol mapping, `origin=GDELT`, `skipDuplicates`).
  Idempotent: re-imports and overlap with prior DOC-API rows are absorbed by `(source,url)`.
- **Verified live 2026-07-19:** 563 days swept → 171,721 matched records → ~100k+ stored
  GDELT rows (the rest windowed-dupes or already-present). This replaced the abandoned
  DOC-API grind entirely.

⚠️ **Run the import on an adequately-sized host.** On a CPU-credit-exhausted burstable VM
(t3.small) the import starves — see `DEPLOYMENT_AWS.md`. The dedup was also re-engineered
(§8, dedup note) from an O(n²) flat scan to a day-bucketed `DatedTitleIndex` after the
flat version CPU-locked the box at 171k records.

## 7B. DOC API path (legacy — targeted top-ups only)

```bash
# A few symbols, checking what would happen first:
bun run news:backfill --from 2025-01-01 --to 2025-06-30 --symbols RELIANCE,TCS,INFY --dry-run
bun run news:backfill --from 2025-01-01 --to 2025-06-30 --symbols RELIANCE,TCS,INFY

# THE WHOLE UNIVERSE via the DOC API — resumable, checkpointed (but slow; prefer §7A):
bun run news:backfill:universe --from 2025-01-01 --to 2025-06-30
```

**For every-universe-symbol runs use `news:backfill:universe`**
(`src/scripts/runNewsBackfillUniverse.ts`), not one giant `news:backfill` call.
It drives the same idempotent backfill one symbol at a time and adds what a
167-symbol run against GDELT's sticky rate limiting needs:

- **Checkpointing** — progress is saved per symbol to a state file (default
  `.cache/gdelt-universe-backfill.json`, keyed to the exact `--from/--to`
  range). Kill it, reboot, re-run the same command: it resumes where it
  stopped. Completed symbols are never re-fetched.
- **Retry passes** — a symbol with any failed window is swept again in later
  passes (`--passes`, default 5), with an escalating wait between passes.
- **Penalty-aware pacing** — ≥5s between symbols regardless of
  `GDELT_RATE_LIMIT_MS`, plus a `--cooldown` (default 300s) pause after any
  throttled symbol so the penalty window drains instead of compounding.
- Exit code 1 + an explicit symbol list if anything is left incomplete —
  re-running the same command finishes the job.

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
4. **Headlines primarily.** The **DOC API** returns titles only (`body` null). The **GAL
   bulk path** additionally stores the `desc` snippet as `body`, giving the mapper a bit
   more text. FinBERT scores headlines either way (B6 v1 scope).
5. **250-record cap per query window (DOC API only).** A busy symbol × 30-day window can
   truncate (detected + warned). Mitigation: lower `GDELT_BATCH_DAYS`; the run stays
   idempotent. The GAL path has no such cap.
6. **Country filter is mandatory — global English news pollutes single-word aliases.**
   *(Learned 2026-07-19, `GDELT_PRECISION_FIX.md`.)* GAL v1 filtered only `lang=en` and
   symbol-mapping precision fell to ~80% (BRITANNIA ~50%): "Britannia" matched a Welsh
   bridge / cruise ship / gold coin, "Lupin" the Netflix show, "Colgate" a US university,
   "federal bank" a US crime. **Fix:** both the downloader and `news:remap` now require
   `isIndianNewsDomain(url)` for GDELT rows (`src/news/indianDomains.ts`) — restoring the DOC
   API's `sourcecountry:IN`. Post-fix GDELT audits at ≥90% (30/30 sample; BRITANNIA ~96%).
   BSE/live rows are Indian-sourced already and unaffected.
7. **Query recall is bounded by the alias dictionary.** *DOC API:* a company is searched by
   its *first* curated alias only — GDELT answers parenthesized-OR phrase queries with its
   429 throttle message even in isolation (live-verified 2026-07-18). *GAL:* the download
   prefilter matches **any** alias in an Indian-domain title (a single combined regex), so
   GAL recall is materially better. Either way the mapper keeps its precision rules on
   what comes back.
   *(dedup note)* Historical dedup uses a day-bucketed, time-windowed `DatedTitleIndex`
   (`dedupe.ts`): a candidate is a duplicate only of titles within ±`NEWS_DEDUPE_WINDOW_DAYS`
   of its **own** publication time. The earlier flat-array scan was O(n²) and CPU-locked the
   import host at 171k records; the index makes each check near-constant and is
   brute-force-equivalence tested.
8. **GDELT titles are tokenized** (spaces around punctuation). A cleanup pass reattaches
   punctuation deterministically, but stored titles can differ cosmetically from the
   publisher's exact headline — dedup and mapping are punctuation-insensitive, so this is
   cosmetic only.
9. **Coverage starts 2017-01-01 (DOC API) / 2020-01-01 (GAL)**, and both endpoints are
   free/unofficial — the same fragility class as every B3 source (rate policy or format can
   change without notice).
10. **Free-text relevance noise.** GDELT can return articles whose *title* never mentions
   the company (match was in the body we don't get). Those rows are stored with
   `symbols = []` (unmatched) — archived but invisible to per-stock research; the precision
   gate stays with the mapper, not the query.

## 9. Where things live

| Piece | File |
|---|---|
| **GAL bulk downloader (preferred, domain-filtered)** | `src/scripts/downloadGalArchive.ts` (`bun run news:gal:download`) |
| **GAL importer → shared pipeline** | `src/scripts/importGalArchive.ts` (`bun run news:gal:import`) |
| **Indian-domain allowlist (precision fix)** | `src/news/indianDomains.ts` · see `GDELT_PRECISION_FIX.md` |
| **Domain-aware remap** | `src/scripts/remapSymbols.ts` (`bun run news:remap`) |
| DOC API client (networking only) | `src/news/gdelt/gdeltClient.ts` |
| Payload parsing + timestamp reconstruction | `src/news/gdelt/parser.ts` |
| Range slicing, query building, pacing | `src/news/gdelt/download.ts` |
| Processing core + batch persistence | `src/news/gdelt/backfill.ts` |
| Time-windowed dedup index | `src/news/dedupe.ts` (`DatedTitleIndex`) |
| DOC API CLI (range/symbols) | `src/scripts/runNewsBackfill.ts` (`bun run news:backfill`) |
| DOC API CLI (full universe, resumable) | `src/scripts/runNewsBackfillUniverse.ts` (`bun run news:backfill:universe`) |
| Schema (`availableAt`, `origin`) + migration | `prisma/schema.prisma` · `prisma/migrations/…_b3_5_news_backfill/` |
| Env knobs | `GDELT_BATCH_DAYS` · `GDELT_LATENCY_MINUTES` · `GDELT_RATE_LIMIT_MS` |
| Tests | `src/news/gdelt/*.test.ts` · `src/news/dedupe.test.ts` |
