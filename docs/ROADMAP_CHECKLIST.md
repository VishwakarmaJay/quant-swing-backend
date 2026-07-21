# QuantSwing — Master Roadmap Checklist

> **The single sequenced tracker.** Everything done and everything planned, in execution
> order. Check items (`[x]`) only when their *definition of done* is met — measured through
> the walk-forward harness where applicable, never off a single window. Keep this file
> updated as work lands; details live in the linked docs.
>
> Companions: [`OPEN_ITEMS.md`](./OPEN_ITEMS.md) (**open tasks + limitations, the live tail**) ·
> [`COMPLETE_REFERENCE.md`](./COMPLETE_REFERENCE.md) (all math + limitations) ·
> [`HANDOFF_NEXT_STEPS.md`](./HANDOFF_NEXT_STEPS.md) (narrative) · [`PHASE6.md`](./PHASE6.md) ·
> [`ARCHITECTURE_REVIEW_B3_B4.md`](./ARCHITECTURE_REVIEW_B3_B4.md) (principal-architect review of the data layer — read before B5/B6 work)

**Standing rules**
- Determinism is sacred: factor changes fail the golden test until consciously re-baselined.
- No config is believed off a single window — everything through `runWalkForward`.
- Point-in-time discipline everywhere: as-of date = the date *we could have known it*
  (filing date for fundamentals, `availableAt` for news — `= fetchedAt` on live rows,
  reconstructed for B3.5 GDELT imports) — never period-end / publishedAt.
- **Phase 5 (paper trading) stays gated** until the portfolio-level backtest beats Nifty
  risk-adjusted, net of costs, **out-of-sample**.

---

## ✅ PART A — Completed (the research program)

- [x] **A1. Phases 1–4 platform** — data foundation, 6-factor layer, golden gate, decision
      layer, persistence, Telegram, backtest engine. *149 tests, typecheck clean.*
- [x] **A2. Step 1 — Factor & gate attribution** (`backtest:attribution`) — nothing
      discriminates (ρ≈0 incl. composite); only the RSI gate filters; **BULL is the loss
      sink (−0.67%/trade)**; volume mildly harmful. → [`ATTRIBUTION.md`](./ATTRIBUTION.md)
- [x] **A3. Step 2 — Doc reconciliation** — all spec drift annotated `[AS-BUILT]` across
      ~20 docs incl. ADR-0008 supersession.
- [x] **A4. Step 3 — SectorRelativeStrengthFactor** — built, observational (weight 0);
      selection test: +0.10 exp at w≈0.25. First orthogonal signal that helps.
- [x] **A5. Step 4 — Fundamental blocked honestly** (no point-in-time data; lookahead
      refused) → redirected: regime experiments prove **filters only avoid BULL, can't fix
      it** (`backtest:regime`). → [`REGIME_ENTRIES.md`](./REGIME_ENTRIES.md)
- [x] **A6. Step 4b + v2 — BULL pullback+resumption entry** — fixes the entry style
      (BULL −1.47 → −0.32 on unseen data); full-window "edge" exposed as in-sample optimism
      by the train/test split (`backtest:pullback`).
- [x] **A7. Phase 6 — walk-forward harness + combined evaluation** (`backtest:phase6`) —
      `pullback+srs0.25` selected on all 3 folds; **OOS: PF 0.91 vs baseline 0.78,
      exp −0.12 vs −0.34. Better, still not profitable.** → [`PHASE6.md`](./PHASE6.md)
- [x] **A8. COMPLETE_REFERENCE.md** — all math, factors, findings, 17 limitations in one file.

**State after Part A:** near-breakeven, honestly measured, no positive OOS edge.
The remaining gap needs orthogonal data + a fair portfolio-level test — Part B.

---

## 🔜 PART B — The build sequence (in execution order)

### ✅ B1. Portfolio-level backtest — *the fair "beat Nifty" gate* — DONE
Results: [`PORTFOLIO_BACKTEST.md`](./PORTFOLIO_BACKTEST.md) · `bun run backtest:portfolio` ·
157/157 tests.
- [x] Simulator (`src/backtest/portfolioSimulator.ts`): one ₹2L base, calendar sweep over
      precomputed trajectories; caps/sizing/kill-switch; entries-before-exits (no lookahead)
- [x] Portfolio metrics: CAGR, true max drawdown, exposure, same-units Nifty comparison
- [x] Sizing variants: flat / conviction / risk — risk-based gives the smallest drawdowns;
      conviction's return win is variance (n≈114, ρ≈0 score), not vindication
- [x] Cost-sensitivity 2×: both degrade ~7pp, **ranking stable** (combined still > baseline)
- [x] OOS evaluation over the Phase-6 test stretch (selection was constant across folds,
      so the continuous OOS run is faithful to the walk-forward pick)
- **📉 VERDICT — the gate is real and currently FAILED by a wide margin:** OOS the
  portfolio lost **−12.7% (combined/conviction) to −23.4% (baseline/flat)** vs Nifty
  **−4.4%**; full window −2.1% vs Nifty +10.0%. Portfolio truth is *worse* than
  signal-edge truth: the 2-slot cap takes only ~15% of signals, picked by an uninformative
  ranking, and compounding turns per-trade drift into deep drawdown (−15…−29%).
  **Combined beats baseline everywhere** (every sizing, both windows, 2× costs) — the
  Phase-6 lever generalizes. New measurable lever surfaced: **slot-allocation ranking**.
  → Reinforces B4→B5 (orthogonal signal) as the critical path; B10 stays hard-gated.

### ✅ B2. Wire the validated config into the nightly run — *operator decision* ⚙️ — DONE
Production emitted the known-worst baseline; now it runs the OOS-validated `srs0.25 +
pullback-v2` config (still not edge — orders remain manual, Phase 5 stays gated).
- [x] Operator sign-off to change live signal behaviour
- [x] Set SRS weight 0.25 in `technicalFactorWeights` + adopt BullPullback entry for BULL —
      graduated via `createProductionStrategy()` (`src/strategy/productionStrategy.ts`), wired
      into `runPipeline`. `DEFAULT_STRATEGY_CONFIG` kept **frozen** as the research baseline so
      the attribution/regime/phase6/portfolio controls stay intact.
- [x] Re-baseline `weightsVersion` (`w-fd0e1dec2aa9` → `w-6edfeb770e4a`, now stamps the
      production config incl. the pullback entry); golden untouched (factor layer unchanged)
- **Done when:** nightly Telegram signals come from the validated config, version-stamped. ✅
      Verified: typecheck clean, 157/157 tests pass, production strategy = the exact
      `pullback+srs0.25` config `backtest:phase6`/`backtest:portfolio` evaluated. (First live
      `signals:run` requires networked infra + backfill — not runnable in-repo.)

### ✅ B3. News scraper + archive — *clock #1* ⏰ — DONE (archive clock running since 2026-07-18)
Full doc (how it works, sources, fetching, limitations): [`NEWS_SCRAPER.md`](./NEWS_SCRAPER.md)
The archive is the asset; FinBERT can score it retroactively. Every week not collecting
is a week of sentiment backtest lost. Module built under `src/news/` (+ `bun run news:ingest`);
187/187 tests, typecheck clean. Live fetch/deploy needs networked infra this session can't run.
- [x] `NewsArticle` schema (`prisma/schema.prisma`): source, url, title, titleNormalized,
      body?, symbols[], `publishedAt`, **`fetchedAt`** (as-of date; model note forbids using
      publishedAt as as-of). `@@unique([source, url])` for idempotent re-ingest.
- [x] RSS ingestion job (15-min RabbitMQ cron): added `createIntervalCron` (`crons/cron.ts`)
      + `NEWS_INGEST` cron; sources = ET Markets, Moneycontrol, BSE announcements XML,
      Google News RSS (`src/news/sources.ts`). In-house tolerant RSS/Atom/BSE parser
      (`rssParser.ts`) — no new dependency. Per-feed no-throw fetch (degrades independently).
- [x] Title normalization + Jaccard dedup across sources (`dedupe.ts`, threshold 0.7;
      recency window `NEWS_DEDUPE_WINDOW_DAYS`); dedups within a run and against the recent DB.
- [x] **Symbol mapper** (`symbolMapper.ts` + `companyAliases.ts`): curated alias dictionary
      covering **all 166** universe symbols (coverage asserted in tests); precision-first —
      conservative multi-word matching, bare group words ("Tata"/"Adani") and word-colliding
      tickers (OIL/SAIL/TITAN/TRENT) deliberately unmatched; unmatched-headline sample +
      `aliasCoverage()` gap report logged by `news:ingest` to grow the dictionary.
- [x] **Live-fetch fixes (2026-07-18)** — first live run showed MONEYCONTROL + BSE
      "fetch failed"; root-caused and fixed:
      1. **UA blocking:** both sites 403 the bot-style UA (`compatible; QuantSwingNewsBot`),
         200 with a browser UA (curl-verified) → `fetch.ts` now sends a browser UA +
         supports per-source headers.
      2. **Moneycontrol RSS is FROZEN at 23 Apr 2024** (every item, both feeds — dead
         regardless of UA) → **replaced with LIVEMINT** (`livemint.com/rss/markets`,
         verified fresh same-day items).
      3. **BSE was the wrong endpoint + dialect** (`notices.xml` = RSS of exchange-circular
         PDFs) → repointed at the **AnnGetData corp-announcements JSON API** with the
         Referer header it requires (WAF-pass verified); `parseBse` now handles the JSON
         `{Table:[…]}` shape + "No Record Found!" alongside legacy XML.
      4. **Frozen-feed detector:** per-source `newestItem` in the ingest report + a
         `⚠️ FROZEN?` status when the newest item is >3 days old (would have caught #2
         instantly).
      Live smoke test: ET 50 · LiveMint 35 · Google 100 items, all fresh; BSE fetch passes,
      parses empty. 188/188 tests, typecheck clean.
- [x] **BSE params confirmed** (operator devtools capture, 2026-07-18): endpoint is
      `AnnSubCategoryGetData/w` with `subcategory=-1`. Key API quirk discovered:
      **only single-day windows are accepted** (`strPrevDate` must equal `strToDate`;
      any range returns `{}` — why every earlier probe "found no records"). The source
      now expands `{date}` into **two same-day fetches (yesterday + today)** so filings
      disseminated past midnight (00:49 in the capture) are never missed; the
      (source,url) unique key makes the overlap idempotent. `SLONGNAME` (company name)
      is prepended to the body so the symbol mapper always sees it through boilerplate
      headlines. **Live smoke test, all 4 sources fresh:** ET 50 · LiveMint 35 ·
      **BSE 56** · Google 100 items (49 symbol-mapped in-run). 188/188 tests.
- [x] **Cron wiring verified**: `registerNewsIngestCron` is in `startCrons()` → `server.ts`
      — ingestion polls every 15 min (`NEWS_INGEST_INTERVAL_MS`) whenever the server runs.
- [x] **First real archive ingest (2026-07-18T03:02Z)**: 124 new articles stored, all 4
      sources ok (ET 5 · LiveMint 32 · BSE 51 · Google 36 new after 116 cross-source
      dupes), newest-item column live. **Archive total 263 articles.**
- [x] **≥90% precision sample — PASSED, then perfected**: manual review of all 54 mapped
      articles (75 symbol-assignments, bodies verified for every multi-symbol map) →
      **92.0%** (69/75). All 6 misses were ONE failure mode: bare `sbi` firing on SBI-group
      subsidiaries (SBI Life — itself SBILIFE! — SBI Funds, SBI Capital). Fixed with a
      general **`ALIAS_EXCLUSIONS`** negative-lookahead mechanism (+7 tests, 189/189 pass);
      stored archive remapped (exactly those 6 rows) → **sample now 100%**.
- [ ] ⏳ Ops residual: keep the server (cron) running; glance at volume/dupe rates over the
      next few days; grow the alias dictionary from the unmatched-headline log.
- **Done when:** articles/day flowing for all 4 sources, deduped, ≥90% of matched symbols
  correct on a manual sample. ✅ **Met (in-repo). Archive clock started 2026-07-18 —
  B7's ~6-month sentiment-backtest countdown runs from this date.**

### ✅ B3.5. Historical News Backfill (GDELT) — *retro-extends the B3 archive, honestly labelled* — DONE (2026-07-18)
Full doc (architecture, provenance, `availableAt` semantics, limitations, ops):
[`GDELT_BACKFILL.md`](./GDELT_BACKFILL.md) · `bun run news:backfill --from … --to …
[--symbols …] [--dry-run]` · full universe (checkpointed/resumable):
`bun run news:backfill:universe --from … --to …`. Data acquisition ONLY — no SentimentFactor, no strategy/factor/
backtest changes; the B7 gate below is *softened, not removed* (reconstructed availability
is weaker evidence than live capture).
- [x] `availableAt` on every `news_article` row — THE as-of field research reads. Live rows:
      `= fetchedAt` (existing semantics untouched; migration stamped all pre-B3.5 rows).
      Historical rows: `= publishedAt + GDELT_LATENCY_MINUTES` (default 30) — reconstructed,
      deliberately conservative, never assumed instantaneous.
- [x] Provenance enum `NewsOrigin` (`LIVE_RSS | LIVE_BSE | GDELT`), required on every row —
      research can always split live-captured from retro-imported (and should validate any
      sentiment conclusion on the live-only subset).
- [x] `src/news/gdelt/` (client / download / parser / backfill, responsibilities separated;
      networking carries no business logic). Reuses the existing pipeline — same Jaccard
      dedup, same alias dictionary (drives BOTH the GDELT queries and the final tagging),
      same symbol mapper, same FinBERT catch-up scoring. No second pipeline.
- [x] Idempotent: stable `(source='GDELT', publisher-url)` identity + archive-time Jaccard
      corpus + `createMany(skipDuplicates)` — re-running a range creates zero duplicates.
- [x] Live-verified against the DOC 2.0 API (2026-07-18): artlist JSON shape, seendate
      format, and the real throttle protocol (HTTP 429 + plain-text notice at >1 req/5s;
      client backs off ≥5s, bounded retries, throttled ≠ empty).
- [x] **GAL bulk path added (2026-07-19) — the way the archive was actually loaded.** The
      DOC API is too throttled for bulk (days per run); the GDELT Article List dataset
      publishes the same metadata as rate-limit-free bulk files. `bun run news:gal:download`
      (workstation sweep, ~90 min for 18 months, any-alias title match, `desc`→`body`) →
      `bun run news:gal:import` (same `processGdeltRecords` core). Live 2026-07-19: 563 days
      → 171,721 matched → **~100k+ GDELT rows** for 2025-01→2026-07.
- [x] Tests: parser, timestamp reconstruction, idempotency, duplicate handling, symbol-
      mapping integration; full suite + typecheck green (B3 live behaviour unchanged —
      same code paths, two new stamped fields).
- **Done when:** a date range can be backfilled repeatably with honest availability +
  provenance on every imported row, through the existing pipeline. ✅ **Met** (GAL bulk
  path is the recommended acquisition route; DOC API kept for top-ups).

### ✅ B3.6. Historical BSE announcements backfill — *exchange-timestamped history* — DONE (2026-07-18)
Full doc: [`BSE_BACKFILL.md`](./BSE_BACKFILL.md) · `bun run news:backfill:bse --from … --to …`.
The exchange-filings counterpart to B3.5: per-scrip wide-range queries (the single-day
API limit is universe-wide only — live-verified for all categories) give every
announcement with the exchange's own `DissemDT`; `availableAt = DissemDT + 30min`
(anchored to exchange truth, not a crawl proxy); `origin = BSE_BACKFILL`; scrip codes
from the B4 archive (167/167). Same pipeline, checkpointed, idempotent. ~1,800 requests
per 2.5 years at WAF-polite pacing. **Loaded 2026-07-19: 57,025 rows, 100% scored.**
Together with B3.5 this softens B7's archive gate: backtestable history exists now —
validate on the live-only subset as it accrues.
- [x] **Dedup fixed to per-company + time-windowed (2026-07-19).** Templated filing titles
      ("Financial Results for the quarter ended…") collapsed across companies *and* across
      quarters under title-only Jaccard — measured ~64% wrongly dropped. Fix keys dedup by
      `bseCompanyKey(body)` into a `DatedTitleIndex` (±`NEWS_DEDUPE_WINDOW_DAYS`). Retention
      30%→~88%; the same day-bucketed index replaced an O(n²) flat scan that CPU-locked the
      import host. Regression tests pin cross-company + cross-quarter survival.

### ✅ Validation gate + observability (2026-07-18/19) — *measure the archive before B7 builds on it* — CLOSED
Archive after all loads + fixes: **GDELT 114,859 (81,001 mapped) · BSE_BACKFILL 57,025
(100% mapped) · LIVE_RSS/BSE ~1k**. Manual precision audits: **BSE 100% · GDELT ≥90%**
(post-fix). Deployed on AWS (`docs/DEPLOYMENT_AWS.md`).
- [x] **`ingest_run` persistence + Telegram alerts** (`src/news/ingestRun.ts`): every ingest
      pass writes a row (per-source, totals, `status`, alert lines) and pages the operator —
      FROZEN feed immediate; source-fail / zero-parse / sidecar-down on the 2nd consecutive
      run; onset-only (no repeat-spam). Closes the architecture review's console-only-ops
      hole now that the archive lives on an unattended VM.
- [x] **Alias growth + remap** (`bun run news:remap`, now domain-aware): grew
      `companyAliases.ts` from the unmatched-headline log (10 forms) and re-tagged stored rows;
      institutionalizes the B3 growth loop.
- [x] Per-origin composition / coverage / timestamp-integrity checks (availableAt exactly
      publishedAt+latency, zero negatives/futures); manual precision sample of imported tags.
- [x] **GDELT precision fix — the gate did its job** (`docs/GDELT_PRECISION_FIX.md`). The audit
      caught GDELT symbol-mapping at ~80% (BRITANNIA ~50%): the GAL bulk downloader had dropped
      the DOC API's `sourcecountry:IN`, so single-word aliases collided with foreign homonyms
      (Britannia the Welsh bridge / cruise ship / coin, Lupin the Netflix show, Colgate the US
      university, "federal bank fraud"). Fix (6 steps, S1–S6): Indian-domain allowlist
      (`src/news/indianDomains.ts`, +36 tests) + surgical `ALIAS_EXCLUSIONS` homonym guards
      (evidence showed the domain filter is the primary lever; aggressive alias-stripping
      rejected to protect recall) + a domain-aware remap that **removed 24,671 false tags** +
      the downloader domain-filtered at source. **Re-audit: GDELT 30/30, BRITANNIA ~96% — gate
      CLEARED.** All in the derivation layer; no scores/prices/factors touched; 328 tests pass.

### ✅ B4. Fundamentals: snapshotter + point-in-time backfill — *clock #2 + the unblock* ⏰ — DONE
Module `src/fundamentals/` (+13 tests, 202/202 pass) · migration `b4_fundamentals`
(`quarterly_fundamental`, `fundamental_snapshot`) · `bun run fundamentals:backfill|snapshot`.
**Verified data recipe (all live-tested):** Screener quarterly table = EPS/profit/sales per
quarter + the BSE scrip code (from the page's own bseindia link); BSE `AnnSubCategoryGetData`
per-scrip with `strCat=Result` accepts WIDE date ranges (the single-day limit is universe-wide
only) = real announcement dates; `availableAt = announcedAt ?? periodEnd + SEBI deadline (45d/60d)`.
- [x] Weekly snapshotter: `snapshotFundamentals()` + `FUNDAMENTALS_SNAPSHOT` cron (7d,
      fires on server boot) → `fundamental_snapshot` rows with `fetchedAt` as-of key
- [x] Historical backfill built + run: **1,984 quarters across 167/167 symbols** (~93%
      announcement-dated, rest SEBI-deadline fallback). Completed via `bun run
      fundamentals:retry` (`runFundamentalsRetry.ts`): self-derives the missing set from the
      DB, gates on a live Screener 200 probe, idempotent. History: Screener
      connection-blocked the IP after ~200 requests at 1.1s pacing (delay raised to 3s);
      the retry recovered 65/66; the last symbol (ZOMATO) 404'd because of the 2025
      ETERNAL rename → added `SCREENER_SYMBOL_ALIASES` in `src/fundamentals/ingest.ts`
      (URL uses the renamed symbol, rows stay keyed on canonical ZOMATO) → 12 quarters,
      all announcement-dated.
- [x] As-of reconstruction (`asOf.ts`, pure + tested): `ttmEpsKnownBy` / `peAsOf`.
      **Boundary-verified on real data:** RELIANCE Apr-20 TTM 59.69 → Apr-27 55.22
      (59.69 − 19.95 + 15.48 exactly — the Mar-26 quarter enters ONLY after its Apr-24
      announcement); PE 22.8 → 24.7 from the information event, not price.
- [x] Spot-verify vs known filings: RELIANCE all 8 quarters carry real dissemination dates
      matching its actual results calendar (Jul-18-25, Oct-17, Jan-16, Apr-24…).
- [x] **Adjustment-consistency audit PASSED (2026-07-18)** — the architecture review's
      CRITICAL assumption verified: (1) **zero** >30% single-day moves across all 167 stocks'
      full 2-yr history → Angel OHLCV is consistently corp-action-adjusted (also validates the
      technical factor stack); (2) computed `PE_asOf(today)` vs Screener's own P/E across 99
      symbols: **median ratio 1.000**, 86/99 within ±10%. Six single-name outliers flagged
      (JSWSTEEL/ABB = results-timing: our TTM already includes the Jul-17 Q1, Screener's P/E
      lagged; SIEMENS/DALBHARAT = demerger/exceptional-item distortions) → B5 must use
      **rank-based (percentile) PE with null/winsor handling**, which it was designed to anyway.
- [x] 66-symbol retry completed (2026-07-18): 65 recovered on first unblocked attempt +
      ZOMATO via the Screener alias fix. Promoter/pledge % deferred (soft-flag only;
      `Corp_ShpPromoters_ng` endpoint verified for when needed).
- **Done when:** every universe stock has an honest as-of fundamental series covering the
  backtest window (announcement-dated, no period-end lookahead). ✅ **Met — 167/167 symbols,
  1,984 quarters. B5 (FundamentalFactor) is unblocked.**

### ✅ B5. FundamentalFactor — *built + measured; floor-mechanism favoured, no weight set* — DONE (2026-07-18)
Full findings: [`FUNDAMENTAL_FACTOR.md`](./FUNDAMENTAL_FACTOR.md) · 221/221 tests, typecheck clean.
- [x] Factor (pure, injected via `ctx.fundamentals` like `sectorPeers`): rank-based
      PE-vs-sector percentile (0.6) + TTM EPS YoY growth (0.4), components renormalize;
      results-proximity exposed as metrics only; pledge % still deferred (B4 note).
      Point-in-time via `fundamentalsAsOf` (announcement-dated, boundary-tested).
- [x] Integrated **observationally** — `buckets.fundamental` explicitly `[]` in the frozen
      baseline (a listed factor would auto-activate the regime blend); golden re-baselined;
      regression tests pin byte-identity; post-integration `backtest:run` reproduces the
      exact documented baseline (981 trades, PF 0.86, −0.224).
- [x] Attribution selection test (`backtest:attribution` §2d/§2e): **bucket blend REJECTED**
      (harmful at every λ, monotone with dose); **floor gate is the working mechanism**
      (concave, peaks at floor=50: +0.07 exp, PF 0.86→0.90) — the terciles show the
      information lives in the low-fundamental tail (−0.38%/trade), not the ranking.
- [x] Walk-forward (`backtest:phase6`, grid = incumbents × floor {none,45,50}): floor
      selected on 2/3 folds; OOS −0.09/PF 0.93 vs incumbent −0.12/0.91 (caveat: per-fold
      pick churns → treat +0.03 as the honest size). Portfolio (`backtest:portfolio`,
      `combined+ff50`): OOS ties-to-beats combined (risk sizing −10.45% vs −13.66%, best
      maxDD −12.2%, stable at 2× costs) but FULL-window worse (thin early coverage).
- **Done when:** fundamental's marginal OOS contribution is measured; weight set (or factor
  rejected) on walk-forward evidence. ✅ **Met: bucket weight rejected on evidence; the
  `fundamentalFloor: 50` lever is validated-but-held-observational — production adoption is
  an operator decision; B9 (joint rerun, with more accrued history) sets the final config.
  Phase 5 stays gated (OOS PF 0.93 < 1, portfolio trails Nifty).**

### ✅ B6. FinBERT sidecar — DONE (2026-07-18; archive scored end-to-end) 🐍
Sidecar: [`sidecar/`](../sidecar/README.md) · client `src/news/sentimentClient.ts` ·
scorer `src/news/scoreArticles.ts` + `bun run sentiment:score` · migration `b6_sentiment`.
- [x] FastAPI + ProsusAI/finbert at **pinned revision `4556d13015211d…`** (model+tokenizer,
      CPU, eval mode → deterministic), batch `/score` + `/health` on 127.0.0.1:8001
      (ADR-0006: localhost-only, no auth). Python 3.11 venv, pinned requirements.
- [x] India-term normalizer pre-pass (`sidecar/normalizer.py`, 7 pytest): numeric
      crore/lakh → converted magnitudes ("Rs 1,200 crore" → "INR 12.00 billion"),
      ₹/Rs → INR, PAT/PBT/YoY/QoQ/bps/NPA/FII/topline → FinBERT vocabulary, Q1FY26 →
      "Q1 fiscal year 26". Case/word-boundary safe ("Pat", "across" untouched).
- [x] Retro-score + ongoing scoring: `sentiment:score` (idempotent, resumable,
      `--rescore` for model bumps) AND a no-throw hook at the end of every news ingest —
      the archive stays scored as it grows. Each row stamps score (pos−neg ∈ [−1,1]),
      label, 3 probs, **`model@revision`**, scoredAt. **All 383 archived articles scored**
      (59% neutral / 27% positive / 14% negative, mean +0.11) — the ingest-cron hook
      scored them live on its first tick after deploy.
- [x] Degraded-neutral verified: dead sidecar → client retries (5s timeout, 2 retries),
      returns null, articles stay unscored, nothing throws; next run catches up.
- **Done when:** archive scored end-to-end; spot-check of Indian headlines acceptable. ✅
      **Met.** Spot-check: profit-beat/stake-increase headlines strongly positive,
      profit-drop/loss headlines strongly negative, SEBI/BSE regulatory boilerplate
      correctly neutral. Known miss: "shares tank as SEBI opens probe" scored weakly
      positive — headline-level FinBERT limitation, noted for B7's aggregation design.

### ✅ B7. SentimentFactor — MEASURED (Phase 2, 2026-07-20); floor favoured, held observational for B9
Full doc: [`SENTIMENT_FACTOR.md`](./SENTIMENT_FACTOR.md). Data-unblocked by B3.5/B3.6 (GDELT
media 2025-01→ + BSE filings 2024-01→, ~2.5yr, provenance-tagged, precision-audited) — no
longer calendar-blocked to Jan 2027. Backfilled rows carry *reconstructed* `availableAt`, so
every evaluation runs **per-origin** (live-only vs +BSE_BACKFILL vs +GDELT).
- [x] **Aggregation core** (`src/news/sentimentAggregate.ts`): recency × confidence weighted,
      chase-decay (half-life 7d), thin-coverage→neutral → per-stock 0–100. Pure, +18 tests.
- [x] **Point-in-time, no lookahead** — reads `availableAt` only, cutoff = midnight(asOf);
      mirrored in the live pre-pass (`loadSentimentInputs`→`runPipeline`) and the backtest
      replay (`loadNewsBySymbol`→`backtestEngine`, via unit-tested `sentimentInputsAsOf`).
- [x] **Factor + observational integration**: `SentimentFactor` registered; frozen baseline
      flipped `buckets.sentiment` `['sentiment']`→`[]` so composite/golden/backtest stay
      **byte-identical** (regression test pins it; gate 7 stays dormant). Golden re-baselined
      (neutral 50 on candle-only fixtures). 358 tests pass, typecheck clean.
- [x] **Phase 2 measurement (2026-07-20, deep 5.5yr window, per-origin)** — full results in
      [`SENTIMENT_FACTOR.md`](./SENTIMENT_FACTOR.md) §4a. Harness extended (per-origin CLI on
      attribution/phase6, `SENTIMENT_ORIGIN_TIERS`, `sentimentFactorFloor` gate + tests,
      sentiment conditioning; 362 tests). Findings: **live tier = clean null control** (0%
      coverage, floors provably inert); **bucket blend REJECTED** (2f — monotone-decaying,
      plus neutral-50 dilution contaminates the test); **floor gate is the mechanism** (2g —
      concave, peak 50: **+0.11 exp on live+bse → +0.01/PF 1.01, first full-window breakeven
      crossing**; +0.07 with GDELT added — stronger on stronger evidence, anti-artifact
      ordering); conditioning terciles show the B5 tail pattern (low −0.33 → high +0.07).
- [x] **Embargoed walk-forward** (grid + sf48/sf50/ff50+sf50, both informative tiers):
      deep-window folds put folds 1–2 before the archive exists, so sentiment was expressible
      only on fold 3 — where **`pullback+srs0.25+ff50+sf50` was selected and delivered
      +0.14/PF 1.12 unseen** (identical on both tiers). OOS concat +0.15/1.10 vs control
      −0.04/0.97, but picks churn 3-configs/3-folds (B5 caveat: partly selection noise).
      Honest evidence class: **selected on 1 of 1 coverage-capable folds** — "≥2/3 folds" was
      structurally unmeetable, not failed.
- **Done when:** sentiment's marginal OOS contribution is measured on the walk-forward,
  validated on the live/BSE (strong-evidence) subset; bucket activated (or rejected) on that
  evidence in B9. ✅ **Measured: bucket rejected; `sentimentFactorFloor: 50` validated-but-
  observational (ff50 precedent, production untouched). B9 must (a) re-test the ff50+sf50
  stack fold-3 actually picked, (b) add a coverage-era fold design, (c) run it through
  `backtest:portfolio`.**

### ✅ B8. Robustness upgrades — DONE (2026-07-18; one honest residual) 🧰
- [x] **B8.1 Deep backfill:** `backfill:ohlcv all 2000` → **1,356 candles/instrument
      (2021-01 → 2026-07, ~5.5yr), 227k candles**, quality ≥0.99 everywhere except the
      natural TMCV short history. (Fixed en route: `persistCandles` dropped its
      `$transaction` wrapper — 200 sequential upserts blew Prisma's 5s interactive-tx
      timeout at 2000-day depth; upserts are idempotent so the tx bought nothing.)
      **New deep-window signal-edge baseline** (`backtest:run`, production config, real
      VIX): 2021-11→2026-07, **4,394 trades, win 43.1%, exp −0.097%/trade, PF 0.94** vs
      Nifty B&H +42.9%. Less bad than the 2yr window (−0.22/0.86) but still no edge —
      and now measured across cycles. All research numbers re-baseline from here (B9
      re-runs attribution/phase6/portfolio on this window with more folds).
- [x] **B8.3 Embargoed walk-forward:** `makeExpandingFolds(..., embargoDays)` — train
      ends N trading days before each test window (a train-end signal's 7-day time-stop
      resolves inside the test = selection leakage). Test windows unchanged → OOS
      concatenation clean. `backtest:phase6` now runs embargo 10d. +2 tests.
- [x] **B8.4 India VIX feed:** INDIA VIX (token 99926017) added to the synced index
      universe (default + stored AppConfig) → `NSE:India VIX` with **1,354 candles
      2021→now**. Live: `loadVixAsOf` (staleness-guarded, 5d) feeds `detectMarketRegime`
      — verified `regime:detect` reports `vix: 13.15` from the store. Backtest:
      `CandleStore.vixByDate` feeds per-day regime detection. Precedence: explicit
      operator value → stored VIX → Nifty-ATR proxy (unchanged fallback).
- [x] **B8.2 Survivorship — mechanism built, historical data still open:**
      `src/universe/membership.ts` (`UNIVERSE_MEMBERSHIP` windows + `isMemberOn`,
      enforced in `generateRawSignals`). **The rule going forward: never delete a
      symbol from the universe — set its `to` date here instead**, so history stays and
      the bias stops compounding. ✅ **Pre-curation past now REPAIRED + MEASURED (2026-07-21,
      see [`SURVIVORSHIP.md`](./SURVIVORSHIP.md)).** The "JS/WAF data block" was false;
      ingested the 10 delisted Nifty-200 victims from the B13 bhavcopy archive
      (`survivorship:ingest`) with point-in-time membership at index-exit dates + a
      membership-gated SRS pre-pass. **Result: survivorship inflated the FULL deep window
      ~4.4pp (b9 risk +4.72%→+0.29%), the decisive COVERAGE gate is UNCHANGED (−17.08% vs
      Nifty +0.80%), and the verdict holds on every window — survivorship is not masking an
      edge.** Residual: ±1-reconstitution window precision (low value).

### ✅ B9. Phase 6 rerun — DONE (2026-07-20); one best strategy, gate still failed
Full doc: [`B9_RERUN.md`](./B9_RERUN.md) · anchored coverage-era folds (`makeAnchoredFolds`,
`backtest:phase6 --from 2024-07-01 --folds 4`) · 369 tests, typecheck clean.
- [x] Re-run attribution across all factors — per-origin on the deep window (B5 §2d/2e; B7 2f/2g)
- [x] **Prune what doesn't contribute:** volume is OUT — `-novol` in every anchored winner
      (8/8) and 2/3 deep winners; no selected config kept it. Step-1's suspicion confirmed jointly.
- [x] **Joint config selection via walk-forward:** anchored 4-fold coverage-era design built
      (the fair multi-fold test B7 lacked) →
      **`pullback+srs0.25+ff50+sf50-novol` selected on all 4 folds × both tiers**; OOS
      −0.04/PF 0.97 vs baseline control −0.47/0.73 (~92% of the loss removed; still not positive).
- [x] **Portfolio gate:** stack beats every config on every window/sizing/cost level; first
      **positive absolute portfolio returns** (FULL +22.8%, OOS +24.8%) and best-ever maxDD
      (−11%) — but on the honest COVERAGE window (its validated era): **−6.5% (risk) vs Nifty
      +0.8% → B10 GATE FAILED** (closest approach yet; B1 was −12.7 vs −4.4).
- [x] ⚙️ **Operator decision (2026-07-20): B9 stack ADOPTED into production.**
      `createProductionStrategy()` now runs `pullback+srs0.25+ff50+sf50-novol`;
      `weightsVersion` re-stamped `w-6edfeb770e4a` → **`w-68f83d8edbf9`** (floors now in the
      hash — any behavioural knob added to production must be); +5 pin tests
      (`productionStrategy.test.ts`), 369/369 pass; frozen research baseline untouched.
      Signals stay manual; B10 stays gated.
- [x] Revisit the survivorship residual (B8.2) — ✅ **done 2026-07-21**: measured, the B9
      conclusions survive it (COVERAGE gate unchanged; FULL −4.4pp; verdict intact). See
      [`SURVIVORSHIP.md`](./SURVIVORSHIP.md).
- [ ] Learned weighting still correctly deferred (all Spearman ≈ 0; working levers are
      tail-trims, not rankings)
- **Done when:** one best evaluated strategy, OOS-validated, with every component earning
  its place. ✅ **Met. Next lever (new, measured): slot allocation — the 2-slot book takes
  ~14% of signals, picked by a ρ≈0 ranking; risk sizing is the drawdown-preserving default.**

### ✅ B11. Slot-allocation research — DONE (2026-07-20); the ranking question, answered NO
Full doc: [`SLOT_ALLOCATION.md`](./SLOT_ALLOCATION.md) · `bun run backtest:slots [tier]` ·
379 tests. B9 named this the largest unworked lever; it is now measured and closed.
- [x] **Mechanism:** `RankKey` on the portfolio simulator (8 orderings incl. a seeded,
      deterministic **`random` control**) + **regret metrics** (`takenNetPctAvg`,
      `skippedNetPctAvg`, **`selectionEdgePct`**) — the book's forgone trades are already
      precomputed, so measuring what it gave up was free. Default stays `composite`
      (byte-identical); +5 tests.
- [x] **Pre-registered rule:** a key earns further work only if it beats `random` on
      `selEdge` across BOTH windows. **Result: NOTHING PASSES.** `fundamental` wins the
      coverage era (+0.14) and reverses on FULL (−0.06); everything else fails outright.
- [x] **The incumbent composite ranking loses to a coin flip on both windows**
      (−0.14 vs −0.01 coverage; +0.03 vs +0.05 FULL) — ρ≈0 reproduced from the allocation
      side by an independent method. `calm`/`tight-stop` are consistently *harmful*
      (−0.33…−0.49): real information, inverted.
- [x] **Slots dose closed too:** widening `maxOpenPositions` degrades monotonically past 3
      (6 slots: −14.8%) — taking more of a negative-expectancy pool compounds the drift.
- [x] **Risk sizing dominates all 12 sizing cells** (composite −1.68 vs flat −16.31; best
      drawdowns everywhere), corroborating B9. Mechanism: conviction sizing allocates ∝ the
      composite — i.e. sizes up on a score that loses to random.
- **Done when:** slot allocation is measured against a control. ✅ **Met — and the answer
  redirects the roadmap: the ~14% bottleneck is SIGNAL QUALITY, not allocation. A portfolio
  optimizer is premature (its objective function doesn't exist yet). Cost: one day; saved:
  a month.**
- [x] ⚙️ **Operator decision TAKEN (2026-07-20): production sizing switched conviction →
      `risk`** on B9+B11 evidence. Enacted as the code default (`PortfolioSizingMode`
      default `risk` in `src/portfolio/types.ts`; `portfolioConfigFromEnv` reads
      `PORTFOLIO_SIZING_MODE`, wired into `runPipeline`); the box carries **no**
      `PORTFOLIO_*` override, so production inherits `risk`. Verified 2026-07-21 (code +
      live `.env`). Live sizing now matches the backtested model instead of scaling by a
      ρ≈0 composite.

### ✅ B12. Event typing + event study — DONE (2026-07-20); right-tail hypothesis NOT confirmed
Full doc: [`EVENT_STUDY.md`](./EVENT_STUDY.md) · `bun run events:study [1|3|5|10]` · 416 tests.
B11 named the right tail as the frontier; this tests whether event typing finds it.
- [x] **Deterministic classifier** (`src/events/classify.ts`, pure, versioned `ev-1.0.0`,
      +27 tests): exchange-label first — BSE's own `(LODR)-<SubCategory>` survives in the
      stored body (39.4% of rows) — then a tight keyword pack (+18%). **57.7% typed**, no
      NLP. Untyped → `OTHER`, never guessed.
- [x] **Event-study math** (`src/events/eventStudy.ts`, pure, +10 tests): forward excess vs
      Nifty at 1/3/5/10d, anchored at the first close **strictly after `availableAt`**;
      reports CI, hit rate and **p90 (the right-tail statistic)**.
- [x] **Result: no event type has a distinctively fat right tail** — p90 spans just 4.1–5.9
      across all 12 types at 5d. Hypothesis as posed is unsupported.
- [x] **The `OTHER` baseline is the key control:** the untyped grab-bag is *also* positive
      (+0.12, CI excludes 0) ⇒ the right null is "a company filed something", not zero.
      Against it only **3 of 12** types clear (INSIDER_PLEDGE, RATING_ACTION, M_AND_A) —
      and INSIDER_PLEDGE is confounded by scheduled trading-window notices.
- [x] **What survives: small monotone drift**, not a tail — ORDER_WIN +0.78 and
      INSIDER_PLEDGE +0.82 at 10d, vs a 0.25% round-trip cost. Thin.
- [x] **EARNINGS_RESULT is flat at every horizon** — the sharpest statement yet of the
      free-data ceiling: we can type *that* results were filed, not *whether they
      surprised*. Surprise needs consensus estimates (paid). No PEAD without it.
- [x] **Hardened the join convention** (the bug this study nearly shipped as a finding):
      `canonicalSymbol`/`byCanonicalSymbol` (`src/universe/symbols.ts`, +8 tests) replaces
      **nine** copy-pasted `-EQ` regexes; collisions are reported, not silently dropped;
      the study hard-fails on zero observations. Post-refactor re-run: byte-identical.
- **Done when:** event types are measured for right-tail contribution. ✅ **Met — negative.
  Nothing graduates to a factor. Remaining free-data right-tail ideas: delivery %
  (NSE bhavcopy, untouched) and de-confounding INSIDER_PLEDGE.**

### ✅ B13. Delivery % (NSE bhavcopy) — DONE (2026-07-20); no right tail, no factor built
Full doc: [`DELIVERY_STUDY.md`](./DELIVERY_STUDY.md) · `bun run bhavcopy:download` +
`bun run delivery:study [horizon]` · 445 tests. The last untouched high-ranked free source.
- [x] **Archive acquired — and it is backtestable TODAY** (unlike sentiment): NSE serves
      the full bhavcopy back past 2021. **1,433 files, 2021-01→2026-07, 227,493 universe
      delivery rows.** Parser +15 tests (leading-space padding, CRLF, `-` placeholders,
      out-of-range rejection, `BAJAJ-AUTO` never truncated); downloader caches, resumes,
      and **validates before caching** so a WAF HTML page can't poison the cache as an
      empty trading day.
- [x] **Three signals with the control and confound built in first:** raw LEVEL (control),
      SURGE vs own 20d baseline (the accumulation hypothesis), SURGE conditioned on volume
      also rising (the confound check). Cross-sectional deciles PER DAY; entry next bar.
- [x] **Result — pre-registered bar NOT met.** Surge is coherently monotone and builds with
      horizon (D10−D1 mean +0.15 at 5d, +0.28 at 10d) but **p90 spread ≈ 0 — no right
      tail** — the effect is ≈ trading cost (0.25% round trip), and the **confound check
      FAILED** (requiring volume up left it unchanged ⇒ mechanism is probably not
      accumulation). **No factor, schema or cron built.**
- [x] **Control worked and found something else:** delivery LEVEL has no return signal but
      a tight monotone relationship to p90/p10 — it is a clean **volatility/liquidity
      proxy**, potentially a sizing/eligibility input, never alpha.
- **Done when:** delivery's right-tail contribution is measured. ✅ **Met — negative.**
- ⚠️ **META-FINDING (B5/B7 + B11 + B12 + B13):** four independent methods now agree —
      every lever found trims the LEFT tail; **nothing identifies large winners.** With
      B12's structural result (we can type *that* results filed, never *whether they
      surprised* — needs paid estimates), the evidence says a **2–7 day horizon on
      large-cap Indian equities with free data may not contain an exploitable right tail.**
      The honest options are structural, not incremental: (1) longer horizon — every drift
      signal found peaks at 10d; (2) mid/small-cap universe; (3) buy estimates data;
      (4) accept the system as decision support. See `DELIVERY_STUDY.md` §4.

### ✅ B14. Longer horizon (the option-1 test) — DONE (2026-07-20); confirmed at signal level, killed at portfolio level
Full doc: [`HORIZON_STUDY.md`](./HORIZON_STUDY.md) · `bun run backtest:horizon` +
`backtest:horizon:portfolio` · 457 tests.
- [x] **Found and fixed a trap that would have produced a false negative:** thesis-break
      (`2 closes < EMA20 || MACD flip`) is a *7-day* thesis, so raising `timeStopDays`
      alone leaves holds **unchanged** (45d time stop → 8.6d actual hold). Now config
      (`closesBelowEmaExit`, `macdFlipExit`); defaults reproduce all prior results exactly;
      +3 tests pin the trap; the sweep prints "naive" control rows so it stays visible.
- [x] **Signal edge: monotone improvement and the right tail finally appears** —
      7d PF 1.07/exp +0.10/p90 +5.30 → 90d PF **1.42**/exp **+1.12**/p90 **+16.68**, win
      rate falling 41.9%→26.0% (trend-following signature). The 7-day exit had been
      amputating the tail four studies went looking for.
- [x] **…but the portfolio gate refutes it.** Signal-edge is ABSOLUTE return, so a 20-day
      hold mechanically collects ~+0.5% of beta (Nifty +42.9% over the window) vs ~+0.09%
      for a 3-day hold. Same-units test: **every variant loses to a flat Nifty on the
      validated coverage era** (best −7.89% vs +0.80%). The one FULL-window "winner"
      (60d/flat +52.2% vs +42.9%) runs **87% exposure with −46.6% drawdown** and reverses
      to **−30.6%** on coverage — leveraged beta, not alpha.
- [x] ⛔ **RETRACTED same day by the walk-forward** (`backtest:horizon:wf`, 4 anchored
      folds, embargo 60d). The draft claimed `30d scaled + risk` was a relative lever;
      OOS the ordering is **exactly inverted and monotone** — 7d incumbent −0.09/PF 0.94
      is BEST, 30d −0.63/0.75, 60d −0.79/0.72. The selection mechanism was itself fooled:
      `60d trend-only` was picked on all 4 train windows and lost on all 4 test windows.
      The portfolio "advantage" was **trading less** (80 trades vs 192), not trading
      better. Refined mechanism: the gain is **regime-specific beta** — it exists in the
      2021–24 bull tape and reverses in the flat coverage era. **The 7d exit is
      vindicated; nothing from B14 is adopted.** (Harness gap closed en route:
      `WFCandidate` can now vary exits, not just entries.)
- **Done when:** the longer-horizon hypothesis is measured at portfolio level. ✅ **Met.**
- ⚠️ **FIFTH consecutive negative on "beat the benchmark"** (B5/B7 · B11 · B12 · B13 · B14).
      Durable finding to carry forward: **if the program continues, continue at ~30 days
      with risk sizing, not 7 days.** Remaining structural options unchanged:
      mid/small-cap universe · paid consensus estimates · accept as decision support.

### ✅ B15. Consolidation (the "wait 6 months" decision's prerequisites) — IN PROGRESS
Direction chosen 2026-07-20: stop hunting edge, keep the archives accruing, revisit ~Jan
2027 when the live-only sentiment tier becomes backtestable. That plan is only as good as
the archive's survival and integrity, so these come first.
- [x] **Horizon finding walk-forward-validated → RETRACTED** (see B14). Closed a harness
      gap en route: `WFCandidate` can now carry exit config, so exits are OOS-testable.
- [x] 🚨 **ARCHIVE BACKUPS — found MISSING, now automated.** There were **no backups at
      all** (no crontab, no backups dir) protecting 278 MB of irreplaceable data. Daily
      cron installed with a completeness guard, 14-day retention, and **both** custom and
      portable plain-SQL formats (the box is pg16; pg15 tooling cannot read custom dumps —
      hit for real). **Restore verified by actually restoring**: 30 benign role-GRANT
      errors, zero data errors, all 173,168 articles / 227,001 candles / 1,984 quarters
      intact. → [`DEPLOYMENT_AWS.md`](./DEPLOYMENT_AWS.md) §5
- [x] ✅ **Offsite copy — DONE (2026-07-20).** Daily push to S3
      (`quantswing-archive-283443834610`, private/versioned/encrypted, 90-day lifecycle) via
      an **instance IAM role** (put-only, scoped to one bucket — no keys on the box; upload
      through the `amazon/aws-cli` Docker image over IMDSv2). Non-fatal on failure.
      **Verified by restoring the S3 copy end-to-end**: box → S3 → scratch DB, all counts
      exact. → [`DEPLOYMENT_AWS.md`](./DEPLOYMENT_AWS.md) §5. ~~Residual: single
      account/region.~~ **[2026-07-21]** Region axis closed by cross-region replication
      (ap-south-1 → ap-southeast-1, `quantswing-archive-dr-…`, role `quantswing-crr-role`,
      verified ~20s); single-**account** is the accepted residual.
- [x] ✅ **`aliasVersion` stamping — DONE (2026-07-20).** `symbols[]` now carries the
      derivation version that produced it: `ALIAS_VERSION` = `av-<hash>` of the alias
      dictionary + exclusions + Indian-domain allowlist (`src/news/aliasVersion.ts`, +5
      tests). Stamped at every write site (ingest, GDELT/BSE backfill, remap); migration
      `b15_alias_version` adds the nullable column; a one-time `news:remap` stamped all
      **172,867** existing rows (0 retagged — the dict is unchanged, confirming the stamp
      is honest — 172,867 version-only restamps), idempotent on re-run. A future dictionary
      change is now a **tracked** version bump the sentiment backtest can split/filter by,
      not a silent rewrite. The reproducibility guarantee `weightsVersion` gives the factor
      pipeline, now extended to the archive.
- [x] ✅ **B16 — Raw-payload capture (the "Bronze layer") — DONE (2026-07-20).** The
      review's governing criticism ("no raw retention — a parser bug can't be replayed
      against last month's feeds") is closed forward. Ingest captures each fetched payload,
      **deduped by content SHA** (CDN-cached re-fetches just bump `seenCount`); bytes are
      gzipped → spooled → shipped to **S3 `raw/<sha>.gz`** by the daily backup (payloads
      out of the pg_dump, box disk bounded to <1 day). A `raw_capture` index row
      (sha/source/url/status/bytes/s3Key) stays in Postgres forever. **Verified end-to-end
      on the box:** live fetch → 5 deduped payloads → S3 → **content-address integrity
      confirmed** (S3 object gunzips to bytes whose SHA == its filename). +4 tests, 457
      total. Non-fatal (never fails ingest). → `NEWS_SCRAPER.md`, `DEPLOYMENT_AWS.md` §5.
      *(Historical rows pre-B16 have no raw — their payloads were discarded at ingest and
      can't be recovered; this is forward-only, as any Bronze layer added late must be.)*
- [x] **De-confound `INSIDER_PLEDGE`** — DONE (2026-07-21, `ev-1.1.0`). Split scheduled
      `TRADING_WINDOW` notices from real SAST/PIT/pledge disclosures (`trading window`
      tested before the pledge rule; +5 classifier tests, 462 total, typecheck clean).
      Re-ran `events:study` on the local archive: the strong `+0.82@10d` cell was the
      **calendar artifact** — `TRADING_WINDOW` (n=1294) keeps the entire well-powered drift;
      genuine `INSIDER_PLEDGE` (n=124) no longer clears the baseline at 10d (CI spans zero).
      B12 §4b confirmed: not a smart-money result. → [`EVENT_STUDY.md`](./EVENT_STUDY.md) §4b.
- [ ] One more attempt at historical index-constituent data (survivorship residual).

### B10. Phase 5 — paper trading 🔒 HARD-GATED
- **Gate (unchanged):** B1's portfolio-level backtest shows the B9 strategy **beats Nifty
  risk-adjusted, net of costs, out-of-sample.** Not before — paper-trading a known-negative
  strategy burns calendar time.
- **Current gate reading (B9, 2026-07-20):** ❌ still failed, but the gap has narrowed
  sharply — the B9 stack loses −6.5% (risk sizing, maxDD −11.1) vs Nifty +0.8% on its
  validated coverage era ([`B9_RERUN.md`](./B9_RERUN.md)); B1's reading was −12.7% vs
  −4.4%. First positive absolute portfolio returns on the FULL/OOS windows.
- [ ] Gate cleared (link the run + numbers here)
- [ ] ≥2-week paper trade, metrics + factor attribution logged from day 1
- [ ] Live fills vs simulated: measure real slippage, recalibrate the cost model

---

## Dependency map

```
B1 portfolio backtest ──────────────┐
B2 wire config (operator) ─┐        │
B3 news archive ────────┬─► B6 FinBERT ──► B7 SentimentFactor ─┐
B3.5 GDELT backfill ────┤ (media history via GAL bulk)         │
B3.6 BSE backfill ──────┘ (exchange-filing history, DissemDT)  │
B4 fundamentals data ──► B5 FundamentalFactor ─────────────────┼──► B9 Phase-6 rerun ──► B10 Phase 5
B8 robustness (parallel) ──────────────────────────────────────┘         (gated by B1's fair test)
```

**Environment note:** B1 is fully buildable/verifiable in-repo. B3/B4/B6 need networked
infra to run and verify (code can be written any time). B2 is an operator decision.
