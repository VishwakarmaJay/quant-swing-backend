# Architecture Review — News Archive (B3) & Fundamentals (B4)

> **Role:** Principal Quant Architect review. **Scope:** B3 + B4 as built, measured against
> an institutional research platform bar (deterministic, explainable, point-in-time
> correct, every improvement backtestable). **Disclosure:** the reviewer authored much of
> this code; the review compensates by being deliberately adversarial toward it.
> **No code was changed for this review.** Companion docs: `NEWS_SCRAPER.md`,
> `ROADMAP_CHECKLIST.md`, `SYSTEM.md`, `HANDOFF_NEXT_STEPS.md`, `ATTRIBUTION.md`.

---

## PHASE 1 — Deep architecture review

### The one structural criticism that governs everything else

B3/B4 are built as **derivation-at-ingest** systems: fetch → parse → tag → store the
*derived* record, discard the raw. Institutional archives are built the opposite way —
**immutable raw capture, versioned derivation**:

```
Bronze (immutable): raw payloads, append-only, capture-timestamped   ← never exists here
Silver (versioned): parsed/normalized records, re-derivable          ← this is all we store
Gold   (versioned): entities, events, features                       ← doesn't exist yet
```

Every high-severity finding below is a symptom of missing Bronze: symbol tags that mutate
when the dictionary grows, EPS that mutates when Screener restates, no way to re-parse
history after a parser fix. The single most valuable structural change to B3/B4 is
**retain raw, version every derivation** — everything else is detail.

### 1.1 `sources.ts` + `fetch.ts` (acquisition)

- **Current design:** static source registry; per-source dialect + headers; `{date}`
  expansion (BSE yesterday+today); browser-UA no-throw fetcher with timeout.
- **Strengths:** per-feed isolation (one dead feed never kills a run); live-verified
  endpoints with documented evidence; WAF workarounds explicit and commented; the
  frozen-feed failure mode was *learned from production* and is now detected.
- **Weaknesses:** single IP, single UA string, no per-host politeness budget shared
  across modules (news and fundamentals implement pacing separately); no retry within a
  run (acceptable at 15-min cadence).
- **Potential bugs:**
  - **[HIGH] Timezone dependence in `resolveSourceUrls`.** `getFullYear()/getMonth()` are
    *server-local*. On an IST machine the BSE day windows align with exchange dates; on a
    UTC deploy every early-morning IST announcement lands in the "wrong" day window.
    Works today because the operator's machine is IST — a deploy-portability landmine.
  - **[MEDIUM] `fetchedAt` is UTC, BSE windows are IST-calendar** — same family of
    date-boundary ambiguity; harmless now, wrong someday.
- **Future risks:** **[HIGH]** WAF policy change cuts off Moneycontrol-class or BSE-class
  sources overnight (UA fingerprinting, cookies, TLS fingerprint). No fallback source per
  category. **[MEDIUM]** Legal/ToS gray zone: browser-UA access to WAF'd endpoints and
  Screener scraping is polite but unlicensed; an institutional deployment needs a data-use
  posture, not just pacing.
- **Hidden assumptions:** feeds are honest about `pubDate`; BSE attachment URL pattern
  (`AttachLive/<name>`) is stable; the four sources jointly cover "the news that matters."
- **Missing components:** **[HIGH] gap recovery.** If the server is down >1 day, BSE
  announcements in the gap are *permanently lost* (only yesterday+today are fetched).
  BSE allows per-scrip wide ranges and per-day universe queries — a `lastSuccessfulDay`
  watermark + catch-up loop is cheap and unbuilt. RSS sources have shallow feeds
  (~50–100 items) — a multi-day outage loses tail articles unrecoverably; this is
  inherent to RSS and should be *documented as an SLA*: archive completeness assumes
  <24h max downtime.

### 1.2 `rssParser.ts` (parsing)

- **Current design:** in-house tolerant regex-based RSS/Atom/BSE-JSON parser; pure;
  malformed items skipped, never thrown.
- **Strengths:** zero dependencies (supply-chain surface ≈ 0); unit-tested against real
  captured payloads; dialect dispatch is clean; `SLONGNAME` injection is a smart
  precision assist.
- **Weaknesses:** regex HTML parsing has a ceiling — nested CDATA, exotic encodings
  (Moneycontrol served ISO-8859-1!), or namespaced tags will silently drop items.
  "Silently" is the problem: **[MEDIUM] no parse-loss accounting** (items present in
  payload vs items parsed) — a parser regression looks identical to a quiet news day.
- **Potential bugs:** **[LOW]** `toIso` uses `Date.parse` on feed-format dates — locale
  and TZ-less strings ("2026-07-18T00:49:02.333", no zone → parsed as *local*). BSE
  timestamps are IST; on a UTC server they'd shift by 5.5h. Same TZ family as 1.1.
- **Technical debt:** no raw payload retention (see governing criticism) — a parser bug
  found next month cannot be replayed against last month's feeds.
- **Missing:** per-source parse-rate metric; encoding detection.

### 1.3 `symbolMapper.ts` + `companyAliases.ts` (entity resolution)

- **Current design:** curated alias dictionary (all 167 symbols), boundary-anchored
  regexes, `ALIAS_EXCLUSIONS` negative lookaheads, precision-first, unmatched-headline
  growth loop. Audited at 92% → 100% on the first live sample.
- **Strengths:** the *decision* to buy precision with recall is correct for a sentiment
  aggregate; the audit-then-fix loop (SBI subsidiaries) is exactly how a research shop
  should operate; coverage is test-asserted.
- **Weaknesses / CRITICAL finding:**
  - **[CRITICAL] Entity resolution is unversioned and retroactively mutable.** `symbols[]`
    is baked at ingest time from a dictionary that will keep evolving; the precision fix
    already *remapped stored rows*. Correct hygiene — but it means the archive's tags are
    a function of *today's* dictionary, and a sentiment backtest run in March and re-run in
    June can differ silently. This violates the platform's own reproducibility creed
    (factor configs are hashed; the alias dictionary is not).
    **Fix direction:** hash the dictionary (`aliasVersion`, like `weightsVersion`), stamp
    it on rows, and treat symbol mapping as a *versioned derived layer* recomputable from
    stored text — not archive truth.
- **Hidden assumptions:** headline text is sufficient for entity resolution (no scrip
  codes in media stories); the universe is static (see 1.6).
- **Scalability:** O(aliases × articles) regex scanning — irrelevant at 500 aliases /
  250 articles per run; would need an Aho-Corasick pass at 50× scale. **[LOW]**
- **Missing:** entity resolution for *non-universe* companies (subsidiaries, unlisted
  rivals, group parents) — required by any future event/knowledge-graph layer.

### 1.4 `dedupe.ts` (dedup)

- **Current design:** Jaccard 0.7 on normalized titles vs a 3-day corpus; duplicates are
  **dropped**.
- **Strengths:** simple, pure, tested; prevents double-weighting in a future aggregate.
- **Weaknesses / HIGH finding:**
  - **[HIGH] Dedup destroys a signal instead of recording it.** Cross-source confirmation
    count is itself information — a story carried by 4 feeds is not the same event as a
    story on 1 feed, and *which* sources carried it is a confidence feature. The drop
    also makes archive content **order-dependent** (whichever source is fetched first
    wins the slot), so the surviving copy's source/body/publishedAt is an artifact of
    iteration order — a reproducibility wart.
    **Fix direction:** store all copies, link them (`duplicateOfId` or an event/cluster
    id). Dedup becomes *clustering*, and the cluster size is a free confidence feature.
- **Scalability:** O(corpus × new) token-set comparisons; fine at 10³/day, needs MinHash/
  LSH at 10⁵/day. **[LOW]** now.
- **Potential bug:** **[LOW]** short titles (≤4 tokens) make Jaccard jumpy; two different
  "X Q1 results" stories about the same company can collapse.

### 1.5 `ingest.ts` + cron (orchestration/ops)

- **Current design:** sequential per-source loop, per-run `fetchedAt`, idempotent insert,
  per-source result table printed to console; 15-min interval cron, fires on boot.
- **Strengths:** idempotency done right (`(source,url)` + urn fallback); per-source
  degradation; the `newestItem`/FROZEN detector is a production-taught control.
- **Weaknesses:**
  - **[HIGH] Observability is console-only.** No `ingest_run` table, no alerting. A dead
    cron, a frozen feed, or a parse collapse is only visible if a human reads stdout.
    The platform *already has* a Telegram alerting path and a persistence pattern
    (`SignalRun`) — news/fundamentals runs should persist summaries and alert on
    anomaly (source failed twice consecutively; volume z-score; FROZEN).
  - **[MEDIUM]** `urn:` fallback keys mean a BSE row without attachment gets a
    title-derived key — retitled re-filings create near-dupe rows (caught by Jaccard, but
    the Jaccard window is only 3 days).
- **Hidden assumption:** the server stays up ≈ continuously (see gap recovery, 1.1).

### 1.6 Schema (`news_article`) + research usefulness

- **Strengths:** `fetchedAt` as-of discipline is explicitly documented *in the schema*;
  idempotency key; normalized-title index.
- **Weaknesses:**
  - **[MEDIUM] No GIN index on `symbols[]`** — the single most common future research
    query ("articles for RELIANCE in window") will table-scan.
  - **[MEDIUM] Universe survivorship leaks into the archive.** Tags cover *today's* 167
    names. When the universe changes, historical articles about new entrants are
    untagged (recoverable only if text is retained and remapping is versioned — see 1.3);
    delisted names' news stops accruing. The archive silently inherits the same
    survivorship bias the backtest already carries.
  - **[LOW]** No language/source-tier metadata; no article-hash for exact-body dedup.
- **Future-ML compatibility:** good bones (raw-ish text + timestamps + entity tags), held
  back only by the versioning gaps above.

### 1.7 B4 — fundamentals (`screenerParser`, `asOf`, `ingest`, schema)

- **Current design:** Screener quarterly table (EPS/profit/sales) + BSE scrip code from
  the same page; BSE per-scrip result-announcement dates; `availableAt = announcedAt ??
  periodEnd + SEBI deadline`; pure as-of lib (`ttmEpsKnownBy`, `peAsOf`) boundary-tested
  on real data; weekly ratio snapshotter; circuit breaker + pacing after a live IP block.
- **Strengths:** the announcement-date discipline is genuinely institutional — the
  RELIANCE Apr-20/Apr-27 boundary test (TTM 59.69 → 55.22, exactly −19.95+15.48) is the
  kind of verification most retail platforms never do. The as-of library is pure and
  testable. The snapshotter ("clock #2") shows correct instinct: current values are
  lookahead for the past, so capture them as time passes.
- **Weaknesses / findings:**
  - **[CRITICAL → ✅ VERIFIED 2026-07-18] Corporate-action adjustment consistency.**
    Audit run same day: zero >30% single-day moves across all 167 stocks' 2-yr history
    (prices adjusted); computed PE_asOf vs Screener's own P/E across 99 symbols → median
    ratio 1.000, 86/99 within ±10%. Six outliers are single-name effects (results-timing,
    demergers/exceptional items) → B5 uses rank-based PE. Original finding kept below for
    the record. **Corporate-action adjustment consistency was assumed, not verified.**
    Screener retroactively adjusts historical EPS for bonuses/splits. Angel One
    historical candles are presumed adjusted too. `PE_asOf = price / TTM_EPS` is only
    correct if **both series are adjusted identically**. RELIANCE's 2025 bonus makes this
    concrete: if price history is adjusted and EPS history is adjusted, PE is right; any
    mismatch silently corrupts PE by the adjustment factor — and a *purist* PIT view must
    also admit the adjusted EPS "as stored" is not the number the market saw that day
    (acceptable for ratio consistency, but it must be a *stated* assumption).
    **A one-day audit exists:** compare computed `PE_asOf(today)` against Screener's own
    published P/E per symbol; discrepancies flag adjustment or share-count problems.
  - **[HIGH] Upsert overwrites history — restatements are invisible.** A backfill re-run
    replaces `epsBasic` in place. If Screener restates (or re-adjusts after a corporate
    action), the value "as known at announcement" is gone. The PIT-honest design is
    append-only observations (`valueObservedAt`) or at minimum `firstValue`/`lastValue`.
  - **[HIGH] Single-source dependency for the most important number.** EPS comes only
    from Screener (unofficial, scrapeable, blockable — it *did* block us). The
    authoritative free source exists: **BSE XBRL result filings** attached to the very
    announcements we already ingest. XBRL parsing is the exit ramp from Screener
    dependency and gives as-filed (unadjusted, timestamped) numbers — true Bronze.
  - **[MEDIUM] TTM requires 4 known quarters** → newly listed names (ZOMATO-class) have
    long PE-null stretches; factor must handle nulls as neutral (design exists via SRS
    precedent, but must be asserted for B5).
  - **[MEDIUM]** Announcement matcher takes the *earliest* announcement in
    (periodEnd, +75d] with `strCat=Result` — board-meeting-outcome notices matched
    correctly in testing, but a company issuing a *results-related* notice (e.g. results
    postponement) before actual results would false-match. Low observed rate; needs a
    keyword guard eventually.
  - **[LOW]** `Corp_ShpPromoters_ng` qtrid space verified but promoter/pledge deferred —
    fine, explicitly scoped out.
- **Ops:** same console-only observability gap as news. Rate-limit posture now correct
  (3–4s pacing, circuit breaker, no double-fetch), learned live.

### 1.8 Severity roll-up

| Sev | Finding | Where |
|---|---|---|
| **CRITICAL** | Entity resolution (symbols[]) unversioned + retroactively mutable | 1.3 |
| **CRITICAL** | Corp-action adjustment consistency (EPS vs price) unverified | 1.7 |
| HIGH | No raw-payload retention (governing criticism) | all |
| HIGH | Dedup drops cross-source confirmation + order-dependent survivor | 1.4 |
| HIGH | EPS upsert overwrites; restatements untracked | 1.7 |
| HIGH | Single-source EPS (Screener) with demonstrated block risk | 1.7 |
| HIGH | BSE outage gap = permanent archive loss (no catch-up watermark) | 1.1 |
| HIGH | Console-only observability; no ingest_run persistence or alerting | 1.5 |
| HIGH | Timezone-dependent date windows (IST assumption baked in) | 1.1/1.2 |
| MEDIUM | Universe survivorship leaks into archive tagging | 1.6 |
| MEDIUM | No GIN index on symbols[]; parse-loss unaccounted; urn-key dupes | 1.2/1.5/1.6 |
| LOW | Jaccard on short titles; Date.parse locale; regex scale ceilings | 1.2/1.4 |

---

## PHASE 2 — Limitation analysis (the 12 from NEWS_SCRAPER.md §9)

Format per item: why → impact on (alpha / backtest / production) → effort → short-term →
long-term → tradeoffs/risks → expected improvement.

**L1. Headline-level signal only.**
Why: full-text fetch multiplies request volume ~10×, hits paywalls/WAFs, and FinBERT was
scoped for headlines. Alpha impact: **material** — headline sentiment is noisy; guidance
tone, one-off vs recurring items, and management language live in bodies/transcripts.
Backtest: same noise → weaker measured edge for B7. Production: none. Effort: medium.
Short-term: fetch full text only for *high-value* articles (symbol-mapped + exchange
filings' attachments, which are PDFs we already have URLs for). Long-term: attachment
archive (PDF → text) + publisher full-text where legally clean. Tradeoffs: storage
(trivial), crawl politeness, extraction QA. Expected: sentiment signal quality up a tier;
enables transcript alpha (Phase 8). Complexity: PDF/text extraction pipeline, versioned.

**L2. Archive only grows forward.**
Why: honest PIT — no free archival news source carries *capture-time* timestamps.
Alpha: none lost (the constraint *protects* alpha estimates). Backtest: hard 6-month gate
for sentiment. Production: none. Effort to "fix": effectively impossible honestly;
GDELT-style archives exist but their timestamps ≠ your availability. Short-term: nothing.
Long-term: nothing — **keep the discipline; the moat is the archive's age**. Risk of
"fixing" it: lookahead contamination that invalidates B7. This limitation is a feature.

**L3. Recall deliberately sacrificed.**
Why: the ≥90% precision gate; wrong tags poison aggregates.
Alpha: moderate — thin-coverage names accumulate few tagged articles → sentiment factor
biased toward large caps (which are also the most efficiently priced — a real concern).
Backtest: coverage-skewed sentiment sample. Production: none. Effort: incremental,
ongoing. Short-term: keep growing aliases from the unmatched log (already looped).
Long-term: two-tier tagging — `symbols_strict` (current) + `symbols_loose` (bare tickers,
group words) stored separately; research can measure whether loose tags add or subtract.
Tradeoffs: schema addition; the loose tier must never silently feed the strict factor.
Expected: recall up materially with precision ring-fenced.

**L4. Mention ≠ subject.**
Why: regex mapping has no notion of salience.
Alpha: mild dilution (exposure-weighted mentions still correlate with subject).
Backtest: mild. Production: none. Effort: small→medium. Short-term: deterministic salience
score — symbol in title (2×) vs body-only (1×), position, mention count — stored, not
filtering. Long-term: event extraction makes "role" explicit (subject/counterparty/
mention) — Phase 4. Expected: cleaner per-stock aggregates at near-zero risk (weights,
not gates).

**L5. Source fragility.** / **L6. WAF dependence.** / **L7. BSE param drift.**
Why: free, contract-less endpoints; one IP; undocumented APIs.
Alpha: none directly; **archive continuity risk** — a месяц gap in the sentiment archive
is a permanent scar in B7's training window. Backtest: gaps become missing-data regimes.
Production: the real exposure. Effort: small. Short-term: (a) persist ingest runs +
Telegram alert on failure/FROZEN/zero-parse (uses existing infra); (b) add one redundant
feed per category (e.g. Business-Standard RSS alternates, NSE announcements API as BSE's
sibling); (c) the BSE gap-recovery watermark. Long-term: source-tier registry with
health-state machine (healthy/degraded/dead) and auto-failover to category siblings.
Tradeoffs: more sources = more dedup pressure (argues again for cluster-not-drop).
Expected production improvement: outage detection from "whenever a human looks" to
minutes; archive continuity SLA becomes real.

**L8. Dedup over/under-fire.**
Why: token Jaccard on short strings.
Alpha: loses confirmation signal (see 1.4 — the bigger issue than misfires).
Backtest: minor. Effort: small. Short-term: cluster-not-drop (link duplicates); guard
Jaccard with a numeric-token veto (differing numbers → not duplicates: "profit up 12%" vs
"up 21%"). Long-term: MinHash + entity-aware clustering inside the event layer.
Expected: recovered confirmation feature + fewer false merges.

**L9. `publishedAt`≤`fetchedAt` gap (≤15 min).**
Why: polling cadence. Alpha: none at 2–7d horizon. Backtest: none if `fetchedAt` is used
(it is). Production: none. Effort to shrink: websockets/push don't exist for these
sources; 5-min polling is the cheap knob. Verdict: leave it; document (done).

**L10. Google redirect URLs.**
Why: Google wraps links. Alpha/backtest: none today; blocks future full-text for those
rows. Effort: small (resolve redirects at fetch time — one extra request per *new*
Google article; or decode from the URL payload). Short-term: resolve-on-ingest for
symbol-mapped articles only. Risk: Google rate limits; keep it best-effort.

**L11. English-only.**
Why: source selection. Alpha: real for small/mid-caps (regional press moves them);
minor for the current large-cap-skewed universe. Effort: medium (sources easy; FinBERT
is English-only → needs translation or an Indic model — both add noise/complexity).
Short-term: nothing. Long-term: regional RSS capture-now-score-later (archive is cheap;
scoring can wait for a good Indic model). Tradeoff: archive bloat vs future option value —
capture is justified by the L2 logic.

**L12. HTML in bodies.**
Why: feeds embed markup. Impact: preprocessing detail. Effort: trivial; fold into B6's
normalizer. Non-issue at architecture level.

---

## PHASE 3 — The free-data hedge-fund redesign

If Jane Street/Two Sigma had to build India equity research on ₹0 data budget, the design
would not primarily be "more feeds." It would be **exchange-filings-first, media-second**:

1. **Primary truth = the regulated disclosure stream.** BSE + NSE corporate announcement
   APIs (both exist; we use BSE) carry *every* material event, categorized, timestamped
   to the second, with attachments (PDF + **XBRL** for results). This is a free,
   legally-clean, structured event feed that most retail stacks ignore in favor of news
   sites. Media (RSS) becomes the *secondary* layer: tone, salience, confirmation — not
   discovery.
2. **Bronze/Silver/Gold layering** (the governing criticism): immutable raw payloads +
   attachments; versioned parsers; versioned entity/event extraction. Every layer
   re-derivable; every derivation stamped (the platform already does this for factor
   configs — extend the same hash-stamp pattern).
3. **The free-data institutional stack for India:**
   - **NSE bhavcopy + delivery %** (daily file, trivially parseable) — institutional
     accumulation proxy, already in the spec as DeliveryPctFactor.
   - **FII/DII daily flows** (exchange-published) — regime layer.
   - **Bulk/block deals, SAST + insider (PIT) disclosures** (exchange files) — smart-money
     events, per stock, dated.
   - **Index constituent change history** (NSE press releases/archives) — kills
     survivorship, upgrades every backtest's honesty.
   - **India VIX + option chain OI/PCR** (NSE) — real regime inputs replacing the ATR
     proxy.
   - **Quarterly shareholding patterns** (BSE endpoint already verified live) — promoter/
     pledge/FII-holding trends.
   - **RBI reference rates, CPI/IIP/GST calendar data** (official, dated) — macro event
     layer.
   - **Credit rating actions** — arrive as BSE announcements (free, already flowing
     through our pipe; just needs event typing).
   - **Concall transcripts + investor presentations** — BSE announcement attachments;
     archive now, NLP later.
   - **Screener** demoted to convenience/cross-check; **XBRL becomes the fundamental
     source of record.**
4. **Everything is an event with `available_at`** (Phase 4) and every event gets a
   deterministic outcome measurement (Phase 6). Alpha research becomes SQL, not vibes.
5. **What they would *not* do:** satellite/shipping/exotic alt-data at this horizon and
   budget — 2–7 day swing alpha in Indian large caps is driven by flows, filings,
   results, and positioning, all above. Exotic data is a distraction here (see Phase 8
   rankings).

---

## PHASE 4 — Event Intelligence architecture

**Yes — events, not articles, should be the research primitive.** Articles are evidence;
events are the thing that has an outcome. The migration is additive (articles remain as
the evidence/RAG layer).

### Entities

```
entity(id, kind: COMPANY|SECTOR|INDEX|MACRO|GROUP|COMMODITY|AGENCY,
       canonicalName, symbol?, aliases_version, meta jsonb)

entity_edge(from_id, to_id, relation: MEMBER_OF_SECTOR | MEMBER_OF_INDEX |
       PART_OF_GROUP | PEER_OF | SUPPLIER_OF? | REGULATED_BY | TRACKS,
       validFrom, validTo, source, confidence)
```

Edges are **time-bounded** (`validFrom/validTo`) — sector reclassifications and index
membership changes are themselves point-in-time facts (this also encodes the constituent
history that fixes survivorship). Free data supports sector/group/index/peer edges today;
supplier edges only opportunistically (from ORDER_WIN counterparties) — do not fantasize
a supply-chain graph from free data.

### Event core

```
event(
  id, type, subtype,
  occurred_at,            -- when the world changed (filing dissemination, print release)
  available_at,           -- when WE could know it (fetchedAt / dissemination) ← PIT key
  title, payload jsonb,   -- typed fields per event type (eps, orderValue, ratingFrom/To…)
  confidence  float,      -- see below
  importance  float,      -- see below
  extractor_version,      -- hash of the rule pack that produced it (re-derivable)
  cluster_key             -- dedup identity (see below)
)
event_entity(event_id, entity_id, role: SUBJECT|COUNTERPARTY|MENTIONED|SECTOR|MACRO_SCOPE)
event_evidence(event_id, article_id | announcement_id | filing_url, source_tier, published_at)
```

### Type taxonomy (v1 — deterministically extractable today)

The decisive free lunch: **BSE already labels announcements** (`CATEGORYNAME`/
`SUBCATNAME` — "Result", "AGM/EGM", "Board Meeting", "Award of Order" family, rating,
buyback…). v1 event typing is a **lookup table, not NLP**:

`EARNINGS_RESULT · BOARD_MEETING · DIVIDEND · BONUS_SPLIT · BUYBACK · ORDER_WIN ·
FUND_RAISE · M&A/RESTRUCTURING · MGMT_CHANGE · RATING_ACTION · PLEDGE_CHANGE ·
SHP_UPDATE · INSIDER_TRADE · REGULATORY_ACTION · CONCALL/PRESENTATION · MACRO_PRINT
(CPI/IIP/GST/RBI_DECISION) · INDEX_CHANGE · OTHER`

Media articles map to types via a versioned keyword rule pack; unmatched → `OTHER` with
evidence retained (re-typeable later under a new extractor_version).

### Confidence, importance, freshness

- **Confidence** = deterministic function of evidence: source tier (exchange filing 1.0 >
  primary media 0.7 > aggregator 0.5), count of independent sources (the recovered dedup
  signal), extraction certainty (exact category lookup 1.0 > keyword rule 0.7).
- **Importance** = *learned from history, computed deterministically*: the event_stats
  table (Phase 6) gives |mean excess move| by (type × sector × cap bucket); importance is
  a read from that table, versioned by its computation date. Bootstrap: BSE
  `CRITICALNEWS` flag + type priors.
- **Freshness/decay:** not stored — computed at read time as `f(now − available_at)`
  with the chase-decay curve from the spec (aggregation-layer concern; storing decayed
  values would break reproducibility).

### Dedup & cross-source validation

`cluster_key = (type, subject_entity, occurred_at::date, discriminator)` where the
discriminator is type-specific (periodEnd for results, orderValue bucket for orders).
New evidence for an existing key **joins the event** (confidence ↑) instead of creating a
duplicate — this is the cluster-not-drop upgrade of the current Jaccard, and cross-source
validation falls out of it for free.

### Market reaction & outcome tracking

Deterministic event study, computed from OHLCV already in the store:

```
event_outcome(event_id, horizon_days ∈ {1,3,5,10,20},
  raw_return, excess_vs_sector, excess_vs_nifty,
  vol_adjusted_excess, computed_at, ohlcv_version)
```

Windows anchor at the first close **after `available_at`** (the same next-open discipline
the trade simulator uses). Re-computable; append-only.

### Integration with QuantSwing

- **Factor layer:** `EventFactor` family — pure factors reading *pre-passed* event
  aggregates injected via `StockContext` (the exact `sectorPeers` pattern):
  results-proximity flag (already in the spec's gates), recent-event score
  (Σ importance × confidence × decay), insider/pledge deltas.
- **SentimentFactor (B7)** consumes event-level aggregates (deduped, confidence-weighted)
  instead of raw article rows — strictly better input, same factor contract.
- **Regime layer:** MACRO_PRINT events give the regime service real inputs (RBI decision
  days, CPI surprises) instead of price proxies only.
- **Decision engine unchanged:** events → factors → the same deterministic gates. No AI
  in the decision path; extraction is rule-based and versioned; any future LLM use is
  extraction-only, offline, stored + stamped, and re-derivable (Phase 7 rules).

---

## PHASE 5 — News × Fundamentals unification

**The insight: B3 and B4 already ingest the same upstream stream twice.** BSE
announcements flow into `news_article` (as headlines) and separately into
`quarterly_fundamental.announcedAt` (as dates). The unification is one ingestion of the
announcement stream, routed by category into the event layer:

| Stream | Today | Unified target |
|---|---|---|
| Quarterly results | Screener EPS + BSE date, separately | `EARNINGS_RESULT` event; payload = as-filed numbers (XBRL when parsed, Screener as cross-check); `quarterly_fundamental` becomes the *typed payload table* hanging off the event |
| Management commentary | not captured | `CONCALL` event; attachment (transcript/presentation PDF) archived at capture time; text extracted later — capture-now-score-later, same as L2 logic |
| Conference calls | not captured | same as above (BSE "Analysts/Institutional Investor Meet" category) |
| Corporate actions (bonus/split/dividend) | invisible (and the root of the CRITICAL adjustment risk) | `BONUS_SPLIT`/`DIVIDEND` events — which *also* become the adjustment ledger that lets us **verify** EPS/price adjustment consistency instead of assuming it |
| Shareholding pattern | endpoint verified, deferred | quarterly `SHP_UPDATE` event; payload = promoter %, pledge %, FII % (with its own filing date as available_at) |
| Promoter activity | not captured | `INSIDER_TRADE`/`PLEDGE_CHANGE` events from SAST/PIT disclosures (exchange-filed, dated) |
| Government orders | headline-only if a feed carries it | `ORDER_WIN` events from the announcement category + keyword pack; payload = counterparty, value if stated |

Dedup rule between the layers: **the exchange filing is always the canonical event**;
media articles attach as evidence (raising confidence/importance) and never mint a
second event for the same cluster_key. That kills the current double-ingestion without
losing either signal.

---

## PHASE 6 — Research database design

Tables (Postgres; all append-only except explicitly-versioned recomputations):

```
entity, entity_edge, event, event_entity, event_evidence, event_outcome   (Phase 4)
news_article        (exists; + aliasVersion, + GIN(symbols), + duplicateOfId/cluster link)
raw_capture(id, source, url, fetched_at, http_status, payload_sha, payload bytea/compressed)
quarterly_fundamental (exists; + append-only observation semantics: valueObservedAt)
fundamental_snapshot  (exists — already append-only ✓)
ingest_run(id, module, started_at, per_source jsonb, totals jsonb, status)
event_stats — MATERIALIZED, versioned:
  (event_type, subtype?, sector?, cap_bucket?, regime?,
   n, mean_excess_5d, sd, ci_lo, ci_hi, hit_rate, mean_excess_by_horizon jsonb,
   computed_at, outcome_version)
```

**How it answers the research questions:** every listed question is one SQL query over
`event × event_entity × event_outcome`, pre-aggregated in `event_stats`:
which types work → rank by `mean_excess / (sd/√n)`; which sectors react → group by
sector edge; macro events → type=MACRO_PRINT joined to index outcomes; average return +
CI → stored per cell (n, mean, sd ⇒ t-interval); combinations → self-join events on
(entity, |Δavailable_at| ≤ window) — co-occurrence cells live in the same stats table
with a `combo_key`; failures → cells with CI strictly below 0 (as informative as
winners).

**Indexing:** `event(available_at)`, `event(type, available_at)`,
`event_entity(entity_id, event_id)`, GIN on `event.payload` and `news_article.symbols`,
`event_outcome(event_id, horizon)`; partial index on `event(type) WHERE type='EARNINGS_RESULT'`
for the hottest path.

**Storage & growth:** volumes are small by DB standards — ~250 articles/day ≈ 90k/yr;
BSE ~3–6k announcements/day universe-wide but only ~200–400/day touch the 167-name
universe; events ≈ 30–80k/yr; outcomes = events × 5 horizons. Ten years fits in
single-node Postgres with room to spare. Raw payloads are the only bulk (compressed
`raw_capture` or filesystem/object-store with sha refs; RSS ~1–2 GB/yr compressed,
attachments (PDF) the largest item — store on disk, reference by sha). Partition
`event`/`event_outcome` by year when they cross ~10⁷ rows (they won't for years).
**Never delete; recomputation writes new versions.**

---

## PHASE 7 — Future-ML readiness (without doing ML now)

The schema above is ML-ready *by construction* if five rules hold. These rules are the
deliverable — they cost nothing today and buy everything later:

1. **Immutable raw + versioned derivation.** Any future model can be trained on
   re-featurized history because the raw is still there and every derived layer names the
   code version that produced it. (Enables: everything.)
2. **`available_at` on every fact.** Leakage-free label construction forever — the
   difference between a paper backtest and self-deception. (Enables: classification,
   ranking, time-series training sets built as-of any date.)
3. **`event_outcome` is the universal label store.** Forward excess returns at fixed
   horizons per event = ready-made supervised targets; per-entity daily aggregation =
   ranking/time-series targets. No new schema in 3 years — just new readers.
4. **Text is retained** (titles, bodies, attachment files by sha). That *is* the
   LLM/RAG corpus: `event_evidence` provides retrieval keys (entity, type, date) and the
   provenance chain RAG needs to cite sources. An embedding index later is a new *index*,
   not a schema change.
5. **`entity_edge` with validity intervals is the graph.** GNN training needs
   (nodes, typed time-bounded edges, node features by date) — all present. Graph models
   are a reader, not a rebuild.

Guardrails that keep this compatible with the platform creed: models may *extract*
(offline, versioned, outputs stored like any derivation) and may *propose weights*
(through the existing walk-forward harness), but the decision path stays the
deterministic factor→gate→portfolio engine. An LLM never emits BUY/SELL; at most it emits
`{type: ORDER_WIN, value: ₹1,200cr, counterparty: NTPC}` into a table a human can audit,
under an extractor_version that makes the run reproducible.

---

## PHASE 8 — Alpha gap analysis (free + legal only, ranked for a 2–7 day horizon)

| # | Source | Research value | Difficulty | Maintenance | Expected alpha (horizon-fit) |
|---|---|---|---|---|---|
| 1 | **Delivery % (NSE bhavcopy)** | High — institutional accumulation proxy, daily, per stock | Low (daily file) | Low | **High** — direct entry-quality signal, already spec'd (v1.5) |
| 2 | **Bulk/block deals + insider (SAST/PIT)** | High — smart-money events, dated, per stock | Low-Med (exchange files) | Low | **High** — event-type with strong priors |
| 3 | **Earnings events fully wired (XBRL + surprise vs own history)** | High — the canonical swing catalyst | Med (XBRL parse) | Med | **High** — results-momentum/PEAD is the most documented effect in this horizon class |
| 4 | **FII/DII daily flows** | Med-High — regime/tape context | Low | Low | Med — conditions everything else (BULL loss-sink was the Step-1 finding) |
| 5 | **India VIX + option-chain OI/PCR** | Med-High — real regime + positioning | Med (NSE API hostility) | Med | Med — replaces the ATR proxy; expiry-week positioning effects |
| 6 | **Index constituent history** | High for *integrity* (kills survivorship) | Low-Med (one-time + upkeep) | Low | Indirect — makes every measured edge honest |
| 7 | **Shareholding/pledge quarterly** | Med — promoter stress + conviction | Low (endpoint verified) | Low | Med — pledge spikes are a real negative catalyst |
| 8 | **Rating actions (via BSE announcements)** | Med — clean dated events | Low (already flowing; needs typing) | Low | Med |
| 9 | **Concall transcripts/presentations (archive now)** | High later | Low to capture, Med to exploit | Low | Deferred — option value, pairs with L1 fix |
| 10 | **Corporate-action ledger (bonus/split/dividend events)** | High for *correctness* (adjustment verification) | Low | Low | Indirect but protects PE/momentum from silent corruption |
| 11 | Macro calendar (RBI/CPI/GST/IIP) | Med — regime events | Low | Low | Low-Med at stock level |
| 12 | USDINR + commodity refs (RBI/MCX) | Med — sector input-cost factors (IT/pharma vs oil users) | Low | Low | Low-Med, sector-conditional |
| 13 | Auto sales & sector monthlies | Med, sector-specific | Med (scattered formats) | Med | Low-Med |
| 14 | Power demand, GST high-freq nowcasts | Low at this horizon | Low | Low | Low |
| 15 | Patents/tenders (GeM portal) | Niche | High (messy) | High | Low for large caps |
| 16 | Satellite/port/freight/container | Mismatched to 2–7d horizon + free-data reality | High | High | ~0 here — **explicitly not recommended** |

Honest summary: at this horizon and universe, the missing alpha is overwhelmingly in
**#1–#7** — flows, filings, results, positioning. Everything exotic below the line is
institutional cosplay on a swing-trading clock.

---

## PHASE 9 — Roadmap by pure engineering value

*(Ordered within tiers by ROI. "Alpha" = expected contribution to closing the measured
−8…−19pp/yr gap vs Nifty; "integrity" = makes measurements more trustworthy.)*

### Immediate wins (<1 day each)
| Item | Why | Deps | Value | Cost | Risk |
|---|---|---|---|---|---|
| **Adjustment-consistency audit** (computed PE_asOf vs Screener's own P/E, all symbols) | Tests the CRITICAL hidden assumption | none | Integrity: critical | hours | none |
| **ingest_run persistence + Telegram alerts** (fail/FROZEN/zero-parse) | Closes the observability hole with existing infra | none | Production: high | hours | none |
| **GIN index on `news_article.symbols`** | Every future research query | none | Med | minutes | none |
| **BSE gap-recovery watermark** (lastSuccessfulDay → catch-up single-day fetches) | Stops permanent archive loss on outage | none | High (archive SLA) | hours | none |
| **`aliasVersion` stamping** on articles + dictionary hash | Turns the CRITICAL reproducibility gap into a tracked version | none | Integrity: high | hours | none |
| **TZ hardening** (explicit IST calendar for exchange dates) | Deploy portability; silent-wrongness class | none | Med | hours | low |

### Small features (<1 week)
| Item | Why | Deps | Value | Cost | Risk |
|---|---|---|---|---|---|
| **Raw-capture layer** (store payload sha + compressed body for every fetch) | The governing criticism; enables all re-derivation | none | Foundational | 2–3d | low |
| **Cluster-not-drop dedup** (link duplicates, keep all copies, confirmation count) | Recovers a free confidence signal; fixes order-dependence | raw helps | High | 2d | low |
| **Delivery % ingestion + factor (observational)** | #1 alpha source; spec'd since v1.5 | bhavcopy job | **Alpha: high** | 3–4d | low |
| **FII/DII flows ingestion** | Regime context | none | Med | 1–2d | low |
| **Bulk/block/insider ingestion → events v0** | #2 alpha source; simple dated files | event core | High | 3–4d | low |
| **Event core schema + BSE category → type lookup** | Phase 4 v1 is a lookup table, not NLP | none | Foundational | 3d | low |
| **Append-only fundamental observations** (restatement tracking) | Fixes the HIGH overwrite finding | none | Integrity: high | 1–2d | low |
| **Index constituent history** | Kills survivorship | none | Integrity: high | 3–4d | low |

### Medium features (<1 month)
| Item | Why | Deps | Value | Cost | Risk |
|---|---|---|---|---|---|
| **Event-study harness (`event_outcome` + `event_stats`)** | Turns the archive into measurable research; importance priors | event core, OHLCV | **Foundational + alpha** | 1–2wk | low |
| **B5 FundamentalFactor** (PE-vs-sector percentile, observational → selection test → walk-forward) | The roadmap's own critical path | B4 (done-ish) | **Alpha: highest single bet** | 1–2wk | med (may show no edge — that's information) |
| **XBRL results parser** | Exit Screener dependency; as-filed PIT truth | raw capture | Integrity+resilience: high | 2–3wk | med (format variance) |
| **Attachment archive + text extraction** (results PDFs, transcripts, presentations) | L1 fix; future NLP corpus | raw capture | High (option value) | 1–2wk | low |
| **NSE announcements as BSE's redundant sibling** | Source failover | event core | Production: med | 1wk | med (NSE API hostility) |
| **VIX + option-chain regime inputs** | Real regime data | NSE access | Med | 1–2wk | med |
| **Corporate-action ledger + adjustment verification job** | Permanent guard on the CRITICAL assumption | event core | Integrity: high | 1wk | low |

### Large projects (>1 month)
| Item | Why | Deps | Value | Cost | Risk |
|---|---|---|---|---|---|
| **Full Event Intelligence** (clusters, confidence, importance from event_stats, entity graph with time-bounded edges) | The institutional research substrate | event core + outcomes | Foundational | 4–8wk | med |
| **FinBERT sidecar + SentimentFactor** (calendar-gated to ~Jan 2027 anyway) | B7 | archive age | Alpha: med (unproven) | 3–4wk | med |
| **Portfolio/slot-allocation research** (the B1 finding: ranking picks 15% of signals with an uninformative score) | Second-largest measured lever after entries | event/factor scores with actual signal | Alpha: high | 4wk+ | med |
| **Learned weighting via walk-forward** (only after features show ρ>0) | Phase-6 vision, correctly gated | new factors with edge | Alpha: conditional | 4wk+ | high if premature |

---

## FINAL VERDICTS

### 1. Overall architecture score: **6.5 / 10**

Scored against *institutional research platform*, not retail tooling (against retail this
is a 9). What earns the 6.5: PIT discipline that is real and *tested* (the RELIANCE
boundary test), determinism culture with enforcement (golden gate, version hashes),
honest measurement (walk-forward, OOS corrections of its own earlier claims), per-feed
degradation, idempotency. What caps it: no immutable raw layer, unversioned entity
resolution, mutable fundamental history, single-source EPS, console-only ops, no event
layer — i.e., the *archive* is not yet held to the same reproducibility standard as the
*factor pipeline*, and at an institution the archive is the crown jewel.

### 2. Top 20 improvements by ROI
1. Adjustment-consistency audit (hours, guards a CRITICAL)
2. ingest_run + Telegram alerting (hours, production eyes)
3. BSE gap-recovery watermark (hours, archive SLA)
4. aliasVersion stamping (hours, reproducibility)
5. Raw-capture layer (days, foundational)
6. Event core + BSE category lookup (days, foundational)
7. Delivery % factor (days, top alpha/effort ratio)
8. Cluster-not-drop dedup (days, free signal)
9. Append-only fundamental observations (days, PIT integrity)
10. Bulk/block/insider events (days, alpha)
11. Event-study harness (weeks, makes everything measurable)
12. B5 FundamentalFactor through walk-forward (weeks, highest single alpha bet)
13. Index constituent history (days, integrity)
14. GIN index + TZ hardening (minutes/hours, hygiene)
15. FII/DII ingestion (days, regime)
16. XBRL parser (weeks, source-of-record independence)
17. Attachment/text archive (weeks, option value)
18. NSE announcement failover (week, resilience)
19. VIX/option-chain regime inputs (weeks)
20. Salience scoring on symbol mentions (days, cleaner aggregates)

### 3. Top 10 hidden risks
1. **EPS/price adjustment mismatch** silently corrupting PE (unverified assumption)
2. **Dictionary evolution** silently changing historical backtests (unversioned tags)
3. **Screener restatement overwrites** destroying as-known-then values
4. **Timezone assumptions** breaking date windows on any non-IST deploy
5. **Multi-day outage** = permanent, invisible archive holes (no catch-up, shallow RSS)
6. **WAF/ToS posture**: three of five upstream sources can revoke access unilaterally;
   there is also a real (if low) legal-gray exposure in browser-UA scraping
7. **Silent cron death** — nothing pages anyone today
8. **Survivorship leaking into the archive** via today's-universe tagging
9. **Dedup order-dependence** making archive contents run-order artifacts
10. **Announcement mis-matching** (results-adjacent notices) contaminating announcedAt

### 4. Top 10 opportunities nobody usually builds
1. **Event-outcome statistics as the importance prior** — self-calibrating event weights,
   deterministically, no ML
2. **The corporate-action ledger as an adjustment *verifier*** (everyone assumes; almost
   nobody checks)
3. **Exchange-filings-first design** — BSE categories give a free, labeled event taxonomy
4. **Failure statistics**: event cells with CI < 0 are tradeable *avoid* signals and
   nobody keeps them
5. **Confirmation-count as confidence** (recovered from dedup clusters) — free
   cross-source validation
6. **Capture-now-score-later archives** (transcripts, regional press) — cheap option
   value on future NLP
7. **Time-bounded entity edges** — sector/index membership as PIT facts, making even
   *classification* backtest-honest
8. **A slot-allocation research program** — B1 proved *which 15% of signals you take*
   matters as much as the signals; almost all retail effort goes to signals only
9. **Self-auditing precision loops** (the SBI audit → exclusion mechanism → remap cycle,
   institutionalized as a scheduled job)
10. **An honest-limitations doc per subsystem** (NEWS_SCRAPER.md §9 style) — the cheapest
    research-integrity tool that almost no shop maintains

### 5. vNext architecture (target state)

```
                        ┌────────────────────────────────────────────────┐
   ACQUISITION          │  BRONZE — immutable raw capture                │
   RSS · BSE/NSE APIs   │  raw_capture(payload sha, fetched_at)          │
   bhavcopy · flows     │  attachments (PDF/XBRL by sha)                 │
   SAST/PIT · SHP       │  append-only · never parsed in place           │
                        └───────────────┬────────────────────────────────┘
                                        │ versioned parsers (parser_version)
                        ┌───────────────▼────────────────────────────────┐
   SILVER               │ articles · announcements · quarters(observed)  │
                        │ bhavcopy rows · flows · filings                │
                        │ every row: available_at + derivation version   │
                        └───────────────┬────────────────────────────────┘
                                        │ versioned extraction (extractor_version)
                        ┌───────────────▼────────────────────────────────┐
   GOLD                 │ ENTITIES (time-bounded edges: sector/index/    │
                        │ group/peer)  ·  EVENTS (typed, clustered,      │
                        │ confidence, importance)  ·  EVENT_OUTCOMES     │
                        │ (deterministic event studies) · EVENT_STATS    │
                        └───────────────┬────────────────────────────────┘
                                        │ cross-sectional pre-passes (as today)
                        ┌───────────────▼────────────────────────────────┐
   FACTOR/DECISION      │ Factors (technical · fundamental · event ·     │
   (unchanged creed)    │ sentiment) → WeightedStrategy gates →          │
                        │ Signal math → Portfolio → persist → Telegram   │
                        │ deterministic · versioned · walk-forward-gated │
                        └────────────────────────────────────────────────┘
   MEASUREMENT          attribution · selection tests · walk-forward ·
                        portfolio simulator · event studies  (all OOS-first)
```

### 6. Is QuantSwing approaching institutional-grade research quality?

**Directionally yes — unusually so for its size — but not yet, and the gap is specific.**

What is already institutional-grade in kind (if not in scale): the point-in-time
discipline (announcedAt/fetchedAt as-of keys, boundary-tested), the determinism
enforcement (golden gate, config hashes), the measurement culture (attribution before
building, selection tests over conditioning, walk-forward after being burned by
in-sample optimism, a portfolio-level fair benchmark), and the habit of writing down
honest limitations. Most professional shops preach these; this codebase demonstrably
practices them.

What still separates it from that level, in order:
1. **Archive-grade data engineering** — immutable raw, versioned derivations, provenance
   on every row. The factor pipeline is reproducible; the data layer isn't yet.
2. **Source-of-record independence** — key numbers come from one scrapeable site rather
   than the regulated filings (XBRL) that sit freely one layer down.
3. **An event/outcome research substrate** — today research questions require bespoke
   scripts; institutional platforms make "does event type X work in sector Y?" a query.
4. **Operational rigor** — alerting, gap recovery, run persistence; a research platform
   is only as good as the continuity of its archives.
5. **Breadth of measured signal** — one validated relative lever family so far;
   institutions run dozens of independently-measured, mostly-rejected hypotheses (the
   rejects are the sign the process works — the platform's own `ATTRIBUTION.md` shows it
   already understands this).
6. **Scale of validation** — 2 years, 3 folds, one regime cycle, one market. The
   *method* is right; the sample is not yet institutional.

None of these require money. Items 1–4 are weeks of disciplined engineering; item 5 is
this roadmap; item 6 is calendar time — which is exactly why the archives (news started
2026-07-18, snapshots weekly) were the right things to start first.
