# BSE Announcements Historical Backfill (B3.6)

> **What this is:** the exchange-filings counterpart to the GDELT media backfill
> ([`GDELT_BACKFILL.md`](./GDELT_BACKFILL.md)) — it retro-fills the news archive with
> **BSE corporate announcements** (results, board meetings, orders, ratings, disclosures)
> for the whole universe, years back, carrying the **most honest historical availability
> evidence possible**: the exchange's own dissemination timestamp.
> **Run:** `bun run news:backfill:bse --from YYYY-MM-DD --to YYYY-MM-DD [--symbols A,B] [--dry-run]`

## 1. Why this beats media backfill

BSE announcements are the *regulated disclosure stream* — every material event, per
stock, timestamped **to the second** (`DissemDT`). Where GDELT rows reconstruct
availability from a crawl-time proxy, a backfilled announcement's

```
availableAt = DissemDT + BSE_BACKFILL_LATENCY_MINUTES (default 30)
```

is anchored to exchange truth: the moment the filing became public, plus the worst-case
lag the live 15-min poll would have had. This is the architecture review's
"exchange-filings-first" recommendation implemented backwards in time.

## 2. The API trick that makes it cheap

The live source can only query the announcements API in **single-day universe-wide
windows** (any range returns `{}`). But **per-scrip queries accept wide date ranges** —
proven live by the fundamentals pipeline for `strCat=Result` and re-verified for
`strCat=-1` (all categories, 2026-07-18: RELIANCE Q1-2025 → 39 rows in one call).
Pagination via the response's `Table1[0].ROWCNT` total.

So the backfill iterates **167 symbols × 90-day windows** (scrip codes come from the
B4 fundamentals archive — all 167 covered) ≈ **~1,800 requests for 2.5 years**, paced at
`BSE_BACKFILL_RATE_LIMIT_MS` (3 s — BSE's WAF blocks fast scrapers; Screener lesson).
Roughly **2 hours** end-to-end. Volume: ~40 announcements/quarter for a large cap →
~60–100k rows for 2.5 years.

## 3. Same pipeline, honest provenance (B3.5 rules)

Rows flow through the **same** code as live capture: `parseBse` (title, attachment-PDF
URL, `SLONGNAME` prepended to the body so boilerplate headlines still symbol-map),
Jaccard dedup against the archive titles *around the announcement's own time*, the
curated symbol mapper, `createMany(skipDuplicates)`.

**Dedup is per-company AND time-windowed (fixed 2026-07-19).** BSE filing titles are
templated ("Financial Results for the quarter ended…", "Board Meeting Intimation") — the
company lives only in the `SLONGNAME` body prefix. A naive title-only Jaccard therefore
(a) collapsed *different companies'* identical filings into one, and (b) collapsed a
company's *quarterly recurrence* of the same title into its first occurrence. Both were
measured on the first full run: **~64% of downloads wrongly dropped, some symbols
retaining ~5%.** The fix keys dedup by `bseCompanyKey(body)` into a per-company
`DatedTitleIndex`, so a filing dedupes only against the *same company's* titles within
±`NEWS_DEDUPE_WINDOW_DAYS` of its own dissemination. **Retention after the fix: ~88%**
(e.g. HDFCBANK 436/495 vs 149/495 before), which is what took the archive to 57,025
BSE_BACKFILL rows.

| Field | Value |
|---|---|
| `source` | `BSE_ANNOUNCEMENTS` — **shared with live capture**, so the `(source,url)` identity space dedupes overlapping days instead of duplicating |
| `origin` | `BSE_BACKFILL` (vs `LIVE_BSE`) — research always distinguishes retro-import from live capture |
| `publishedAt` | `DissemDT` (exchange dissemination) |
| `availableAt` | `DissemDT` + latency margin — THE as-of field |
| `fetchedAt` | import time (bookkeeping only) |

Idempotency: attachment URL (or the live pipeline's `urn:` title fallback) under the
unique key + Jaccard + `skipDuplicates` — re-runs create zero duplicates. Checkpointed
per symbol (`.cache/bse-backfill.json`, range-keyed); re-run the same command to resume.

## 4. Limitations (honest list)

1. **Filings, not journalism.** Much of the stream is procedural boilerplate FinBERT
   scores neutral; the sentiment signal concentrates in results/orders/ratings rows.
   The value is event coverage + timestamps, not tone volume.
2. **Boilerplate Jaccard collisions (bounded by §3's per-company, time-windowed dedup).**
   Two *different* filings from the *same company* within the recency window with
   near-identical titles can still collapse — but cross-company and cross-quarter
   collisions (the big losses) are fixed. Residual over-merge is now small and same-policy
   as live.
3. **Latency margin is still an assumption** (default 30 min), just anchored to a far
   better base than GDELT's crawl time.
4. **BSE only** — NSE-only listings (none in the current universe) would be invisible.
5. **Scrip-code dependency:** symbols are queryable only where B4 stored a
   `bseScripCode` (currently 167/167).
6. **API is undocumented** and WAF-guarded; params can drift silently (the live
   source's `parsed=0` tripwire applies here as a failed-window count).

## 5. Where things live

| Piece | File |
|---|---|
| Download (per-scrip, ROWCNT pagination) | `src/news/bse/download.ts` |
| Processing core + persistence | `src/news/bse/backfill.ts` |
| CLI (checkpointed) | `src/scripts/runBseBackfill.ts` (`bun run news:backfill:bse`) |
| Env knobs | `BSE_BACKFILL_LATENCY_MINUTES` · `BSE_BACKFILL_RATE_LIMIT_MS` |
| Migration | `b3_6_bse_backfill_origin` (adds `NewsOrigin.BSE_BACKFILL`) |
| Tests | `src/news/bse/backfill.test.ts` |
