# News Scraper — how it works, sources, fetching, limitations

> **What this is:** the B3 news-archive collector (`src/news/`) — the asset the future
> SentimentFactor (B7) will be backtested on. **The archive clock started 2026-07-18**;
> sentiment becomes honestly backtestable ~6 months after that date.
> **Run manually:** `bun run news:ingest` · **Runs automatically:** every 15 min
> (`NEWS_INGEST` cron, registered in `startCrons()` — active whenever the server is up).

---

## 1. The design idea in one paragraph

Articles are collected **now** and scored **later**. FinBERT (B6) can score stored
headlines retroactively, so the scraper's only irreplaceable job is *capturing headlines
with an honest timestamp as time passes* — a clock that cannot be rewound. Everything else
(sentiment scoring, aggregation, the factor) is deferred work on top of this archive.
The one discipline that makes the future backtest honest: an article's as-of date is
**`fetchedAt`** (when *we* saw it), never the feed's own `publishedAt` — you can only trade
on news after you received it.

## 2. Pipeline (one ingestion pass)

```
for each source (independently, one dead feed never stops the others):
  resolveSourceUrls(source)        # 1 URL normally; BSE expands to 2 (see §4)
        │
        ▼
  fetchFeed(url, headers)          # browser UA, 15s timeout, no-throw → null on failure
        │
        ▼
  parseFeed(payload, dialect)      # in-house RSS/Atom parser, or BSE JSON/XML dialect
        │
        ▼
  normalizeTitle → Jaccard dedup   # vs recent DB titles AND titles accepted this run
        │
        ▼
  mapArticleSymbols(title, body)   # curated alias dictionary → universe symbols
        │
        ▼
  prisma.newsArticle.create        # (source,url) unique → idempotent re-ingest
```

Everything except the fetch and the DB write is **pure and unit-tested** (parser, dedup,
symbol mapper, URL resolution). 45+ tests cover the module.

## 3. The four sources (live-verified 2026-07-18)

| Source | Endpoint | Dialect | Notes |
|---|---|---|---|
| **ET_MARKETS** | `economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms` | RSS | No UA filtering; ~50 items/pass |
| **LIVEMINT** | `livemint.com/rss/markets` | RSS (CDATA-wrapped) | ~35 items/pass, same-day fresh. **Replaced MONEYCONTROL** — Moneycontrol's public RSS is frozen at 23 Apr 2024 (every item, both feeds; verified with a browser UA). A frozen feed passes fetch and parse with healthy-looking counts — only the item *dates* reveal it |
| **BSE_ANNOUNCEMENTS** | `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?...&strPrevDate={date}&strToDate={date}...&subcategory=-1` | `bse` (JSON) | Corporate announcements (results, AGMs, board meetings) — the highest-precision per-stock source. Endpoint + params confirmed from the live ann.html page (operator devtools capture) |
| **GOOGLE_NEWS** | `news.google.com/rss/search?q=(nifty OR sensex OR NSE) when:1d&hl=en-IN&gl=IN&ceid=IN:en` | RSS | Aggregator sweep, ~100 items/pass; catches stories the direct feeds miss |

First live pass: 241 parsed → 124 stored (116 cross-source dupes caught), 49 symbol-mapped.

## 4. How fetching works (`fetch.ts`, `sources.ts`)

- **Browser User-Agent, not a bot UA.** Moneycontrol (Akamai) and BSE's WAF return
  **HTTP 403** to `(compatible; …Bot)`-style UAs and 200 to a browser UA on the *same
  public URLs* (curl-verified). All fetches send a Chrome-like UA.
- **Per-source headers.** BSE additionally requires a `Referer: bseindia.com/corporates/ann.html`
  header to pass its WAF; sources can declare `headers` that merge over the defaults.
- **No-throw, per-feed isolation.** 15s timeout (`NEWS_FETCH_TIMEOUT_MS`); any failure
  logs a warning and returns null — the source is marked `fetch failed` for the run and
  the others continue.
- **BSE single-day quirk → two URLs per run.** The announcements API accepts **only
  single-day windows** (`strPrevDate` must equal `strToDate`; any range returns `{}` —
  live-verified, and the reason early probes "found no records"). The `{date}` placeholder
  therefore expands to **two same-day fetches: yesterday + today**, so filings disseminated
  around midnight (a 00:49 dissemination was in the verification capture) are never missed.
  The `(source,url)` unique key makes the overlap idempotent. A source only counts as
  failed if **all** its URLs fail.
- **Cadence:** every 15 minutes (`NEWS_INGEST_INTERVAL_MS`), fires once on boot, runs
  regardless of market hours (news doesn't keep exchange hours).

## 5. Parsing (`rssParser.ts`)

- **In-house, dependency-free, tolerant.** Handles RSS 2.0 `<item>` and Atom `<entry>`,
  CDATA wrappers, HTML entities, Atom `link href` variants, Google News's guid-wrapped
  links. A malformed item is skipped, never thrown — ingestion degrades, doesn't crash.
- **BSE dialect:** the API's JSON `{ Table: [ { HEADLINE, NEWSSUB, NEWS_DT, DissemDT,
  ATTACHMENTNAME, SLONGNAME, … } ] }` (and the literal `"No Record Found!"` for an empty
  window), plus the legacy XML `<Table>` shape. **`SLONGNAME` (the company's full name) is
  prepended to the body** so the symbol mapper always sees it — BSE headlines are often
  boilerplate ("Intimation under Regulation 30…") with the company name only in other fields.
  Attachment PDFs resolve to `bseindia.com/xml-data/corpfiling/AttachLive/<name>`.

## 6. Symbol mapping (`symbolMapper.ts`, `companyAliases.ts`)

- **Precision over recall, by design.** The gate is "≥90% of matched symbols correct";
  a missed mention is acceptable, a wrong tag pollutes the future sentiment signal.
- **Curated alias dictionary** covering all 167 universe symbols (coverage asserted by a
  test). Matching is case-insensitive, word-boundary-anchored, whitespace-flexible.
  Deliberately **not** matched: bare tickers colliding with English words (TITAN, TRENT,
  OIL, SAIL), bare group names ("Tata", "Adani", "Bajaj") that map to many members.
- **`ALIAS_EXCLUSIONS`** — negative-lookahead blocks for group prefixes: bare `sbi` does
  not match "SBI **Life**" (a different universe stock!), "SBI **Funds/Capital/Cards**…" —
  the single failure mode found in the live precision audit. "SBI raises rates" still
  maps to SBIN.
- **Measured precision:** manual audit of all 54 mapped articles from the first live run
  (75 symbol-assignments, bodies verified for every multi-symbol tag): **92.0%**, all six
  misses being the SBI-subsidiary mode → exclusions added, stored rows remapped →
  **100% on the audited sample**.
- **Growth loop:** every run logs a sample of unmatched headlines + alias-coverage gaps —
  the dictionary is meant to be grown from this log over time.

## 7. Dedup (`dedupe.ts`)

The same story syndicates across feeds with near-identical headlines; counting it twice
would double-weight one event in a future sentiment aggregate. Titles are normalized
(lowercase, punctuation stripped) and compared by **Jaccard token similarity (threshold
0.7)** against (a) DB titles from the last `NEWS_DEDUPE_WINDOW_DAYS` (3) and (b) titles
already accepted in the current run. Exact re-fetches are separately absorbed by the
`(source,url)` unique constraint (`alreadyStored`).

## 8. Monitoring (`news:ingest` report)

Per-source table each run: `parsed / new / dupes / stored / unmatched / newest item /
status`. Two purpose-built alarms:
- **`newest item` + `⚠️ FROZEN?`** — flags a feed whose newest item is >3 days old.
  Item *counts* look perfectly healthy on a frozen feed (Moneycontrol's did); only the
  dates expose it. This detector exists because that failure mode was hit in production.
- **Unmatched-headline sample** — the alias-dictionary growth queue.

## 9. Limitations (honest list)

1. **Headline-level signal only.** RSS descriptions/BSE subjects are stored when present,
   but full article text is not fetched. FinBERT will mostly score headlines — noisier
   than full-text sentiment. (Storing raw text now, scoring later, still preserves the
   option to upgrade.)
2. **The archive only grows forward.** No historical news backfill exists (that's *why*
   the clock matters) — sentiment cannot be backtested before ~Jan 2027, and early-window
   results will rest on the thinnest slice of archive.
3. **Recall is deliberately sacrificed.** Bare tickers, group names, and ambiguous
   shorthand are unmatched; "HDFC" alone doesn't tag HDFCBANK, index-level stories tag
   nothing. Per-stock article counts are therefore an *undercount*, and thinly-covered
   small caps may accumulate few tagged articles.
4. **Mention ≠ subject.** The mapper tags any genuine mention — "HDFC Bank among 4 book
   runners" tags HDFCBANK though the story is about someone's IPO. Fine for sentiment
   aggregation (it *is* exposure), but it is not topic classification.
5. **Source fragility.** All four feeds are free, unofficial-contract endpoints that can
   change or die silently — Moneycontrol's froze without any error signal. The FROZEN
   detector catches death-by-staleness; a *renamed* endpoint shows as `fetch failed`; both
   still need a human to act on the report.
6. **WAF/UA dependence.** Moneycontrol-class and BSE-class access works because of a
   browser UA + Referer. A WAF policy change (fingerprinting, cookies, rate rules) can cut
   off a source at any time. Everything runs from one IP with no proxy rotation — sustained
   over-fetching gets the IP blocked (observed live with Screener on the fundamentals side;
   the news cadence of one pass / 15 min is far below that threshold).
7. **BSE params can drift.** The announcements API is undocumented; the current params
   came from a devtools capture. A site redesign can silently change them — the per-source
   `parsed=0` count on the report is the tripwire.
8. **Dedup can over- and under-fire.** Jaccard 0.7 on short titles occasionally collapses
   two genuinely different stories about the same company, and misses duplicates rewritten
   beyond token overlap. Threshold is config (`NEWS_DEDUPE_WINDOW_DAYS`, constant in code).
9. **`publishedAt` ≤ `fetchedAt` gap.** With a 15-min poll, an article can be up to ~15
   minutes old when captured (plus feed-side publication lag). For a *daily* swing signal
   this is negligible, but the archive's honest availability time is `fetchedAt`, and any
   future intraday use must respect that.
10. **Google News links are redirect URLs** (news.google.com/rss/articles/…), not
    publisher URLs — fine as unique keys, useless for later full-text fetching.
11. **English-only sources.** Regional-language coverage (notable for smaller companies)
    is absent.
12. **Body text may embed HTML/links** (feed-dependent); FinBERT preprocessing (B6's
    India-term normalizer) must clean before scoring.

## 10. Where things live

| Piece | File |
|---|---|
| Source registry + URL resolution | `src/news/sources.ts` |
| Fetcher (UA, headers, timeout) | `src/news/fetch.ts` |
| RSS/Atom/BSE parser | `src/news/rssParser.ts` |
| Symbol mapper + exclusions | `src/news/symbolMapper.ts`, `src/news/companyAliases.ts` |
| Dedup | `src/news/dedupe.ts` |
| Orchestrator | `src/news/ingest.ts` |
| Cron | `src/crons/newsIngest.ts` |
| Manual run/report | `src/scripts/runNewsIngest.ts` (`bun run news:ingest`) |
| Schema | `prisma/schema.prisma` → `news_article` |
| Env knobs | `NEWS_INGEST_INTERVAL_MS` · `NEWS_DEDUPE_WINDOW_DAYS` · `NEWS_FETCH_TIMEOUT_MS` |
