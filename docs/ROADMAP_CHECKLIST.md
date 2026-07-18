# QuantSwing — Master Roadmap Checklist

> **The single sequenced tracker.** Everything done and everything planned, in execution
> order. Check items (`[x]`) only when their *definition of done* is met — measured through
> the walk-forward harness where applicable, never off a single window. Keep this file
> updated as work lands; details live in the linked docs.
>
> Companions: [`COMPLETE_REFERENCE.md`](./COMPLETE_REFERENCE.md) (all math + limitations) ·
> [`HANDOFF_NEXT_STEPS.md`](./HANDOFF_NEXT_STEPS.md) (narrative) · [`PHASE6.md`](./PHASE6.md) ·
> [`ARCHITECTURE_REVIEW_B3_B4.md`](./ARCHITECTURE_REVIEW_B3_B4.md) (principal-architect review of the data layer — read before B5/B6 work)

**Standing rules**
- Determinism is sacred: factor changes fail the golden test until consciously re-baselined.
- No config is believed off a single window — everything through `runWalkForward`.
- Point-in-time discipline everywhere: as-of date = the date *we could have known it*
  (filing date for fundamentals, `fetchedAt` for news) — never period-end / publishedAt.
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

### B7. SentimentFactor — ⏳ gated on ~6 months of B3 archive (clock started 2026-07-18 → ready ≈ Jan 2027)
- [ ] Aggregation: recency-weighted, deduped, chase-decay → per-stock 0–100
- [ ] Observational first; sentiment bucket + gate 7 activate automatically
- [ ] Walk-forward once the archive window is long enough to split honestly
- **Done when:** sentiment's marginal OOS contribution measured over ≥6mo of archive.

### B8. Robustness upgrades — *parallel, whenever* 🧰
- [ ] Backfill OHLCV to Angel One's ~2000-day limit → more folds, more cycles
- [ ] Historical index-constituent data (NSE change records) → kill survivorship bias
- [ ] Purged/embargoed walk-forward boundaries if longer-lookback signals arrive
- [ ] VIX feed (replace Nifty-ATR proxy)

### B9. Phase 6 rerun — joint weighting over the enriched set 🎯 after B5 (and B7)
- [ ] Re-run attribution across all factors (technical + fundamental [+ sentiment])
- [ ] Prune what doesn't contribute (volume is the standing suspect)
- [ ] Joint config selection via walk-forward; consider learned weighting (logistic → GBM)
      **only if** features now show discrimination (ρ meaningfully > 0)
- **Done when:** one best evaluated strategy, OOS-validated, with every component earning
  its place.

### B10. Phase 5 — paper trading 🔒 HARD-GATED
- **Gate (unchanged):** B1's portfolio-level backtest shows the B9 strategy **beats Nifty
  risk-adjusted, net of costs, out-of-sample.** Not before — paper-trading a known-negative
  strategy burns calendar time.
- **Current gate reading (B1, 2026-07):** ❌ failed by a wide margin — OOS portfolio
  −12.7%…−23.4% vs Nifty −4.4% ([`PORTFOLIO_BACKTEST.md`](./PORTFOLIO_BACKTEST.md)).
- [ ] Gate cleared (link the run + numbers here)
- [ ] ≥2-week paper trade, metrics + factor attribution logged from day 1
- [ ] Live fills vs simulated: measure real slippage, recalibrate the cost model

---

## Dependency map

```
B1 portfolio backtest ──────────────┐
B2 wire config (operator) ─┐        │
B3 news archive ──► B6 FinBERT ──► B7 SentimentFactor ─┐
B4 fundamentals data ──► B5 FundamentalFactor ─────────┼──► B9 Phase-6 rerun ──► B10 Phase 5
B8 robustness (parallel) ──────────────────────────────┘         (gated by B1's fair test)
```

**Environment note:** B1 is fully buildable/verifiable in-repo. B3/B4/B6 need networked
infra to run and verify (code can be written any time). B2 is an operator decision.
