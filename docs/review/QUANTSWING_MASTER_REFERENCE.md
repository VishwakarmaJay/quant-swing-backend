# QuantSwing — Master Reference

**One document: what the project is, every factor and calculation, how news articles are ingested/ranked/scored, every indicator and concept used, and exactly what is complete.**

| | |
|---|---|
| Repo | `VishwakarmaJay/quant-swing-backend` (public) |
| Snapshot | commit `93cbb86` — 2026-07-21 · 66 commits total |
| Doc generated | 2026-07-22 |
| Test suite | **473 tests** · 45 test files · strict `tsc` clean |
| Status | Phases 1–4 + Part B (B1–B16) complete · **B10 / Phase 5 hard-gated** |
| Production config | `pullback+srs0.25+ff50+sf50-novol` · `w-68f83d8edbf9` · risk sizing |

**New since the previous snapshot (`ad90509`, 11 commits):** offsite S3 backup + cross-region replication · `aliasVersion` stamping · **B16 raw-payload capture (Bronze layer)** · `INSIDER_PLEDGE` de-confound · **survivorship repair built + measured** · **mid-cap spike (Option B) tested → negative** · Option C decision brief.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [The honest bottom line](#2-the-honest-bottom-line)
3. [The strategic fork](#3-the-strategic-fork)
4. [Pipeline at a glance](#4-pipeline-at-a-glance)
5. [Tech stack](#5-tech-stack)
6. [Data foundation](#6-data-foundation)
7. [Indicators — exact math](#7-indicators--exact-math)
8. [The 8 factors — exact math](#8-the-8-factors--exact-math)
9. [News & articles — ingestion, mapping, ranking, scoring](#9-news--articles--ingestion-mapping-ranking-scoring)
10. [Fundamentals — point-in-time data](#10-fundamentals--point-in-time-data)
11. [Delivery % (NSE bhavcopy)](#11-delivery--nse-bhavcopy)
12. [Event classification](#12-event-classification)
13. [Survivorship repair](#13-survivorship-repair)
14. [Market regime detection](#14-market-regime-detection)
15. [Strategy layer — composite, gates, two configs](#15-strategy-layer--composite-gates-two-configs)
16. [Signal math — entry, stop, targets, R:R](#16-signal-math--entry-stop-targets-rr)
17. [Portfolio manager — sizing and caps](#17-portfolio-manager--sizing-and-caps)
18. [Persistence & reproducibility stamps](#18-persistence--reproducibility-stamps)
19. [Delivery (Telegram)](#19-delivery-telegram)
20. [Backtesting machinery](#20-backtesting-machinery)
21. [All research findings, with numbers](#21-all-research-findings-with-numbers)
22. [What is complete — full checklist](#22-what-is-complete--full-checklist)
23. [What is NOT done](#23-what-is-not-done)
24. [Known limitations](#24-known-limitations)
25. [Configuration reference](#25-configuration-reference)
26. [Scripts & cron schedule](#26-scripts--cron-schedule)
27. [Database schema](#27-database-schema)
28. [Glossary of concepts used](#28-glossary-of-concepts-used)

---

## 1. What this project is

QuantSwing is a **deterministic, explainable quantitative decision-support system for Indian equities (NSE)**.

It scans a **~166-stock universe every evening** and produces **ranked, gated, risk-sized swing-trade signals** (7-day holding horizon, long-only `BUY`) with a full reproducibility trail, delivered to Telegram.

**Orders are placed manually by the operator.** This is decision support, not an execution bot.

**Design creed (enforced in code and CI):**
- Every number is reproducible from stored data + versioned config.
- No randomness, no wall-clock reads inside factor logic.
- Every rejection has a recorded reason.
- Point-in-time is sacred: the as-of date is the date *we could have known it*.
- Nothing is believed off a single window.
- New factors land **observational** (weight 0) and graduate only on walk-forward evidence.

> **README drift:** the repo README describes an "Automated Intraday Options Trading Platform." The as-built system is **nightly, cash-equity, and manual**. The `Instrument` model retains option scaffolding from a legacy OMS layer, but the research pipeline filters equities. Treat `SYSTEM.md`, `OPEN_ITEMS.md`, and this document as authoritative over the README.

---

## 2. The honest bottom line

The system is **complete, rigorous, and has no out-of-sample edge.** This is stated plainly in the source code (`productionStrategy.ts`) and every research doc.

**Current measurement (B9 stack, `pullback+srs0.25+ff50+sf50-novol`):**

| Measure | Result |
|---|---|
| Signal edge (coverage-era OOS) | **−0.04%/trade, PF 0.97** (baseline: −0.47, PF 0.73) |
| Portfolio FULL window | +22.8% |
| Portfolio OOS window | +24.8%, maxDD −11% |
| Nifty over same windows | +42.9% / +34.4% |
| **Portfolio on validated COVERAGE era** | **−6.5% vs Nifty +0.8% → GATE FAILED** |
| Deep window (B8.1, 5.5yr, 4,394 trades) | win 43.1%, exp −0.097%/trade, PF 0.94 |

> ⚠️ **Number discrepancy to be aware of.** `B9_RERUN.md` reports the COVERAGE gate at **−6.5% vs Nifty +0.8%**, while `SURVIVORSHIP.md`'s baseline run of the same window/sizing reports **−17.08% vs Nifty +0.80%**. Both are reproduced here as their source docs state them. The Nifty figure agrees; the strategy figure does not. Worth reconciling — likely different config/params between the two runs.

### Six independent negatives

Every method agrees: every lever **trims the left tail**; *nothing identifies large winners*.

| # | Study | Finding |
|---|---|---|
| 1 | **B5/B7 factor floors** | Information lives in negative tails, not rankings. Every Spearman ρ ≈ 0. |
| 2 | **B11 slot allocation** | No ordering key beats a seeded random control; the composite ranking *loses* to a coin flip. |
| 3 | **B12 event typing** | No event type has a distinctively fat right tail (p90 spans 4.1–5.9). Can type *that* results were filed, never *whether they surprised*. |
| 4 | **B13 delivery %** | Surge is monotone but p90 spread ≈ 0; effect ≈ trading costs. |
| 5 | **B14 longer horizon** | Right tail appears (p90 +5.3 → +16.7, PF 1.07 → 1.42) but it is **market beta**; walk-forward inverted the claim the same day. |
| 6 | **Mid-cap spike (Option B)** | OOS −0.04% / PF 0.98 on Nifty Midcap 150 — **no better than large-caps**. Thesis refuted. |

**Plus the survivorship check:** correcting for delisted names moved the deep window −4.4pp and left the decisive COVERAGE gate **unchanged**. Survivorship is **not** masking an edge.

**Conclusion recorded in the docs:** a 2–7 day horizon on Indian equities with **free data** does not contain an exploitable right tail — at any horizon, allocation, event type, data source, or **market-cap segment** tried.

---

## 3. The strategic fork

`OPEN_ITEMS.md` §1 — *"the next direction is a choice, not a task."*

| Option | What it is | Odds / cost |
|---|---|---|
| **A. Consolidate + wait** *(active default)* | Stop hunting edge; let the archive accrue; revisit **~Jan 2027** when the live-only sentiment tier becomes backtestable. | Near-zero cost; the only genuinely *new* information source. Chosen 2026-07-20. |
| **B. Mid/small-cap universe** | ~~Free-data inefficiency likelier down-cap.~~ **✅ TESTED 2026-07-21 → NEGATIVE.** | Was moderate; now **low**. Tooling exists if ever reopened. |
| **C. Buy consensus estimates** | Unlocks earnings-surprise / PEAD — the one documented effect at this horizon the system structurally cannot see. Scoped in `OPTION_C_ESTIMATES.md`. | **Highest odds of working.** A *spend* decision, not engineering. |
| **D. Accept as decision support** | Freeze research; keep the nightly factory running as-is. | A legitimate end state, not a failure. |

**Resolution (2026-07-21):** the free-data avenues are **exhausted**. There is no remaining *free* engineering that changes the verdict — the next move is a **budget call (fund C) or a stance (accept A/D)**, not another study.

### Option C in brief — what buying estimates would take

- **Data needed:** point-in-time consensus **EPS** (ideally revenue) per symbol per fiscal quarter, as it stood **before** each announcement. Surprise = `(actual − consensus) / |consensus|`, joined to the announcement-dated actuals already in `quarterly_fundamental`.
- **Point-in-time is non-negotiable** — a vendor serving only *current* consensus is useless (reintroduces lookahead).
- **Scale:** ~167 names × ~4 quarters × ~5.5yr ≈ **~3,700 surprise observations**.
- **Providers:** LSEG I/B/E/S / Bloomberg / FactSet / S&P Capital IQ (gold standard, enterprise pricing) · Trendlyne / Tijori / Screener Pro (retail tiers, ₹thousands–₹tens-of-thousands/yr — **must verify they serve pre-announcement PIT consensus**).
- **Cheapest de-risk:** buy a **one-time historical snapshot** to backtest the hypothesis before committing to a recurring feed.
- **Pipeline is ~90% ready.** Only the consensus number is missing. Integration ≈ 2–3 days: `consensus_estimate` table → PIT loader → `surpriseAsOf()` join → `EarningsSurpriseFactor` (observational, weight 0) → the standard B5/B7/B9 measurement protocol.

---

## 4. Pipeline at a glance

```
Angel One (scrip master + historical candles + live LTP)
        │
        ▼
 Instrument master ──► Universe (166 equities + 3 indices + India VIX + 10 survivorship names)
        │
        ▼
 OHLCV store (daily candles)  ◄── nightly incremental update
        │
        ▼
 DataQualityService  ──► StockContext (candles ≤ asOf, no lookahead, + Nifty benchmark)
        │
        ▼
 8 Factors ──► FeatureBundle (immutable, deep-frozen)
        │       [4 directional in composite · Volatility → signal math ·
        │        SectorRelativeStrength 0.25 in PRODUCTION · Fundamental + Sentiment observational]
        │
        ▼
 MarketRegimeService (Nifty trend + breadth + VIX)
        │
        ▼
 Strategy (regime-weighted composite + 7 gates) ──► TradeCandidate | Rejection
        │
        ▼
 Signal math (ATR stop, T1/T2, R:R)             ──► levels | Rejection
        │
        ▼
 PortfolioManager (risk sizing, caps, kill switch) ──► ApprovedSignal | Rejection
        │
        ▼
 Persistence (SignalRun + Signal + SignalRejection, version-stamped)
        │
        ▼
 Delivery (AlertFormatter → Telegram, retry → undelivered queue)
```

Each stage is a **pure function of injected inputs** plus a thin I/O "builder". Same inputs → byte-identical outputs.

---

## 5. Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | **Bun** + **TypeScript** (strict) |
| HTTP | Express 5 (internal `/health`) |
| DB | **PostgreSQL** via **Prisma** + Prisma Migrate |
| Cache / live LTP | **Redis** (`ltp:<id>` keys, pub/sub) |
| Jobs / cron | **RabbitMQ** durable queues + interval pollers |
| Market data | **Angel One SmartAPI** + **NSE bhavcopy archive** |
| Delivery | **Telegram Bot API** |
| Sentiment scoring | **FinBERT sidecar** — FastAPI + `ProsusAI/finbert` at pinned revision, CPU, localhost-only (ADR-0006) |
| Object storage | **S3** — backups + raw-payload Bronze layer, cross-region replicated |
| Tests | `bun:test` (unit + golden), Testcontainers-ready |
| CI/CD | GitHub Actions (typecheck + test) → Docker image → ghcr.io |
| Deployment | One EC2 **t3.small**, five containers via `docker-compose` |

**All indicator math is in-house** (no external TA library) so it is versioned, auditable, and golden-tested.

---

## 6. Data foundation

### 6.1 Instrument master & universe

`syncInstrumentMaster` downloads the Angel One scrip master JSON and filters to:
- **166 NSE equities** (`instrumentType = 'EQ'`) across **23 sectors** (`src/universe/equityUniverse.ts`, committed reference data)
- **3 index rows** (`AMXIDX`): NIFTY, BANKNIFTY, SENSEX
- **India VIX** (token 99926017)
- **+10 delisted survivorship names** (ingested from bhavcopy, see §13)
- Optional **`EQ_MID`** midcap cohort (`MID:<sym>`, scoped by `universeType` so large-cap backtests are untouched)

Handling:
- Corporate-action aliases explicit (`ZOMATO → ETERNAL`, `LTIM → LTM`, `TATAMOTORS → TMCV + TMPV`)
- Unresolved symbols **reported, never silently dropped**
- Tick sizes converted paise → ₹
- Each equity carries its **sector**
- **`UNIVERSE_MEMBERSHIP`** (B8.2) gives point-in-time membership windows — a name only participates while it was actually in the index

### 6.2 OHLCV store

- `Ohlcv` table: daily candles keyed `(instrumentId, tradeDate)`, append-only via upsert
- Research baseline: **5.5 years / 227,001 candles**
- **Nightly incremental** (16:30 IST) fetches forward from last stored candle; overlapping the last day re-settles a candle first captured mid-session
- **Bhavcopy → OHLCV parser** (`src/ohlcv/bhavcopyOhlcv.ts`, +7 tests) with `backAdjustSplits`

### 6.3 Corporate-action back-adjustment (fixed 2026-07-21)

NSE bhavcopy's `PREV_CLOSE` is the **raw (unadjusted) prior close**. Verified: NAUKRI's 1:5 split ex-date shows `PREV_CLOSE 6984.50` next to `OPEN 1387.50`.

The original `backAdjustSplits` compared PREV_CLOSE to the *prior row's close* and so **missed every split** (NAUKRI −80%, SRF −81% fake crashes).

**Fix:** use the gap-robust per-row ratio
```
splitRatio = PREV_CLOSE / OPEN        // = 5.03 for NAUKRI
```
Now adjusts 11 names correctly; series verified continuous.

### 6.4 DataQualityService — the choke point

```
malformed(c)  = any(o,h,l,c ≤ 0) OR volume < 0 OR high < low
                OR high < max(open,close) OR low > min(open,close)

continuity    = min(1, present_candles / (weekdays_in_span × tradingDayFraction))
                where tradingDayFraction = 0.94   (≈ 1 − holiday ratio)

stalenessDays = asOf − last_candle_date   (calendar days)

score = continuity
        × (1 − malformedRatio)
        × (stale     ? 0.5 : 1)   // stale    if stalenessDays > 5
        × (tooShort  ? 0.5 : 1)   // tooShort if candles < 200
```

**Score < 0.8 → instrument skipped.** Index candles have `volume = 0` (legitimate) and are *not* malformed.

---

## 7. Indicators — exact math

All in-house, golden-tested.

### EMA (SMA-seeded), period `p`
```
EMA[p−1] = SMA(values[0..p−1])
k        = 2 / (p + 1)
EMA[i]   = (value[i] − EMA[i−1]) × k + EMA[i−1]      for i ≥ p
```

### RSI (Wilder smoothing), period `p` (default 14)
```
seed:  avgGain = mean(gains over first p changes)
       avgLoss = mean(losses over first p changes)

step:  avgGain = (avgGain × (p−1) + gain_i) / p
       avgLoss = (avgLoss × (p−1) + loss_i) / p

RS  = avgGain / avgLoss
RSI = 100 − 100 / (1 + RS)            (avgLoss = 0 ⇒ RSI = 100)
```

### MACD — fast 12, slow 26, signal 9
```
macdLine  = EMA(close, 12) − EMA(close, 26)
signal    = EMA(macdLine, 9)
histogram = macdLine − signal
```

### ATR (Wilder), period 14
```
TR[i]  = max( high[i] − low[i],
              |high[i] − close[i−1]|,
              |low[i]  − close[i−1]| )

ATR[p] = mean(TR[1..p])
ATR[i] = (ATR[i−1] × (p−1) + TR[i]) / p
```

### SMA
Simple arithmetic mean over the window (volume baselines, EMA seeding).

### Tie-safe mid-rank percentile
Used by SectorRelativeStrength, Fundamental value, ATR percentile:
```
percentile = (count_below + 0.5 × count_equal) / total
```

### Delivery surge (B13)
```
baseline = mean(deliveryPct over [index−lookback, index−1])   // STRICTLY BEFORE
surge    = deliveryPct[index] / baseline                       // lookback = 20
         → null if incomplete baseline
```

### Split back-adjustment (§6.3)
```
splitRatio = PREV_CLOSE / OPEN
```

---

## 8. The 8 factors — exact math

### 8.1 Contracts

```typescript
interface Factor {
  name: string;
  category: FactorCategory;                  // TREND | MOMENTUM | RELATIVE_STRENGTH | VOLUME | VOLATILITY | FUNDAMENTAL | SENTIMENT
  evaluate(ctx: StockContext): FactorOutput; // PURE — no clock/random/env
}

type FactorOutput = {
  score: number;                 // 0–100, higher = more bullish
  agreementContribution: number; // directional lean in [−1, +1]
  explanations: string[];
  metrics: Record<string, MetricValue>;
};

type StockContext = {
  symbol: string;
  asOf: string;                  // ISO date — injected, never wall clock
  candles: Candle[];             // ascending, ≤ asOf (no lookahead)
  dataQualityScore: number;
  sector: string | null;
  benchmark: { symbol: 'NIFTY'; candles: Candle[] } | null;
  sectorPeers?: ...;             // cross-sectional pre-pass (membership-gated)
  fundamentals?: ...;            // point-in-time pre-pass
  sentiment?: ...;               // point-in-time pre-pass
};
```

`buildFeatureBundle` times each factor, attaches `executionTimeMs`, then **deep-freezes** the bundle. Timing lives outside `evaluate` so output stays byte-identical.

Default convention: `agreementContribution = (score − 50) / 50`.

### 8.2 Factor roster

| Factor | Role |
|---|---|
| Trend, Momentum, RelativeStrength, Volume | directional technical composite |
| Volatility | **non-directional** — feeds signal math/sizing, never the composite |
| SectorRelativeStrength | weight **0.25 in production**, 0 in frozen baseline |
| Fundamental (B5), Sentiment (B7) | computed into every bundle, **observational** (empty buckets) |

---

### 8.3 TrendFactor — EMA 20/50/200 stack

25 points per satisfied condition (sum = 100):
```
+25 if price > EMA20
+25 if EMA20 > EMA50
+25 if EMA50 > EMA200
+25 if price > EMA200
```
100 = perfect bullish stack · 0 = perfect bearish stack.

---

### 8.4 MomentumFactor — MACD + RSI (50/50 blend)

```
macdScore = (macd > 0 ? 50 : 0) + (histogram > 0 ? 50 : 0)   // 0 / 50 / 100
rsiScore  = clamp(RSI, 0, 100)                               // RSI used directly
score     = 0.5 × macdScore + 0.5 × rsiScore
```

Overbought filtering is the *strategy's* job (its RSI gate) — a momentum factor reports strong momentum, it does not mean-revert it.

---

### 8.5 RelativeStrengthFactor — vs Nifty (lookback 60)

```
stockRet = (close_now − close_60ago) / close_60ago × 100
benchRet = same for NIFTY
excess   = stockRet − benchRet
norm     = clamp(excess / excessCapPct, −1, +1)    // excessCapPct = 20
score    = 50 + norm × 50
```

Outperforming Nifty by ≥ 20% over 60 days → 100; underperforming by ≥ 20% → 0.

---

### 8.6 SectorRelativeStrengthFactor — rank within sector (lookback 60)

```
selfRet    = 60d return of this stock
peerRets   = 60d returns of every equity in this stock's sector (cross-sectional pre-pass)
percentile = (peers_below + 0.5 × peers_equal) / peerCount     // tie-safe mid-rank
score      = percentile × 100
```

The **cross-sectional half of relative strength**: not "is it beating the market" but "does it lead or lag the stocks it trades alongside."

Peer returns injected via `ctx.sectorPeers` by a pre-pass so `evaluate` stays pure. Neutral 50 when < 3 peers or history too short.

**Membership-gated (2026-07-21):** the peer pre-pass and breadth now honour `isMemberOn`, so a name that has left the universe no longer pollutes its old sector's peer ranking. Baseline-neutral (empty membership ⇒ every stock always a member).

**Status:** the **first orthogonal factor that measurably helped** — selection test improved expectancy −0.22 → −0.13, PF 0.86 → 0.92, by dropping ~125 sector-laggard trades. Concave in weight (peaks ≈ 0.25). **Production weight 0.25.**

---

### 8.7 VolumeFactor — volume-confirmed direction

```
baseVol    = SMA(volume, 20)
recentVol  = SMA(volume, 5)
relVol     = recentVol / baseVol
recentRet  = (close − close_5ago) / close_5ago
dir        = sign(recentRet)                            // −1 / 0 / +1
conviction = clamp((relVol − 1) / convictionCap, 0, 1)  // convictionCap = 1 (2× avg = full)
score      = 50 + dir × conviction × 50
```

Volume **amplifies** price direction, never flips it: up-move on heavy volume → toward 100 (accumulation); down-move on heavy volume → toward 0 (distribution); average/thin → 50 (unconfirmed).

**Status: PRUNED FROM PRODUCTION.** `-novol` in **8/8** anchored B9 winners. Attribution flagged it mildly harmful; joint selection confirmed. Still computed, observational only.

---

### 8.8 VolatilityFactor — ATR% favourability (non-directional)

```
atrPct = ATR14 / close × 100

score  = 100                                            if atrPct ≤ idealAtrPct  (1.5)
       = 0                                              if atrPct ≥ rejectAtrPct (6.0)
       = 100 × (reject − atrPct) / (reject − ideal)      otherwise (linear)
```

`agreementContribution = 0` **always**. ATR percentile (mid-rank, lookback 100) exposed as an informational metric. `atr`/`atrPct` feed the stop and sizing rules.

---

### 8.9 FundamentalFactor (B5) — value + growth

**VALUE — P/E percentile within sector (cheaper = higher):**
```
peers        = sector peers with valid P/E (nulls / loss-makers EXCLUDED, not winsorized)
require        peers.length ≥ minPeers (3)

above        = count(peer P/E > own P/E)
equal        = count(peer P/E = own P/E)
cheaperPctl  = (above + 0.5 × equal) / peers.length     // 0..1, 1 = cheapest
valueScore   = cheaperPctl × 100
```
Rank-based by design (B4 adjustment audit) — robust to single-name P/E outliers from demergers and exceptional items.

**GROWTH — TTM EPS YoY, saturating at ±growthCapPct (40):**
```
if ttmEpsPrevYear > 0:
    growthPct   = (ttmEps − ttmEpsPrevYear) / ttmEpsPrevYear × 100
    growthScore = 50 + clamp(growthPct / growthCapPct, −1, +1) × 50

else if ttmEps > 0:                 // loss → profit turnaround
    growthScore = 100

else:                               // loss-making both years
    growth component dropped
```
Needs **8 known quarters**.

**Blend:** `valueWeight 0.6 / growthWeight 0.4`, renormalized over present components. No data → neutral 50, agreement 0.

Inputs arrive from **announcement-dated** quarters (a June quarter announced 17 July did not exist on 1 July). `resultsPending` / `daysSinceLastResult` are **metrics only** (risk flags), never scored.

**Status:** observational. Bucket blend rejected (monotone-harmful); **floor gate at 50 validated** and adopted in production.

---

### 8.10 SentimentFactor (B7) — FinBERT aggregate

Factor-level math (full article pipeline in §9):

```
per article i (as-of filtered upstream):
  recency(i)    = 0.5 ^ (ageDays_i / halfLifeDays)     // chase-decay, halfLife = 7d
  confidence(i) = clamp(1 − neutralProb_i, 0, 1)       // decisive > "meh"
  w(i)          = recency(i) × confidence(i)

mean      = Σ w(i) · clamp(score_i, −1, 1) / Σ w(i)    // score_i = pos − neg ∈ [−1,1]
sentiment = 50 + 50 × mean                             // 0–100, 50 = neutral
```

Config: `windowDays 30`, `halfLifeDays 7`, `minArticles 3`.

**Thin coverage = no information, not bearish silence.** Below `minArticles`, or when Σw ≈ 0, the aggregate returns `null` and the factor stays neutral 50. This **deliberately biases toward well-covered large caps** — a documented limitation, not an accident.

**Status:** observational. The `sentimentFactorFloor: 50` gate is **the strongest single selection lever measured** (+0.11 expectancy on the strong-evidence tier — the first full-window breakeven crossing), but walk-forward-validated on only 1 coverage-capable fold. Adopted as a floor in production; bucket stays dormant.

---

## 9. News & articles — ingestion, mapping, ranking, scoring

**The design idea:** articles are collected **now** and scored **later**. FinBERT can score stored headlines retroactively, so the scraper's only irreplaceable job is *capturing headlines with an honest timestamp as time passes* — a clock that cannot be rewound.

**Archive clock started 2026-07-18.** Live-only sentiment becomes honestly backtestable ~Jan 2027.

Current archive: **~173,000 articles** (172,867 alias-stamped; 173,168 verified in the restore test).

### 9.1 One ingestion pass

```
for each source (independently — one dead feed never stops the others):
  resolveSourceUrls(source)        # 1 URL normally; BSE expands to 2
        │
        ▼
  fetchFeed(url, headers)          # browser UA, 15s timeout, no-throw → null on failure
        │
        ├──► rawCapture()          # [B16] gzip + content-SHA → spool → S3 raw/<sha>.gz
        ▼
  parseFeed(payload, dialect)      # in-house RSS/Atom parser, or BSE JSON/XML dialect
        │
        ▼
  normalizeTitle → Jaccard dedup   # vs recent DB titles AND titles accepted this run
        │
        ▼
  mapArticleSymbols(title, body)   # curated alias dictionary → universe symbols
        │                          # stamped with ALIAS_VERSION
        ▼
  prisma.newsArticle.create        # (source,url) unique → idempotent re-ingest
```

Everything except fetch and DB write is **pure and unit-tested**. 45+ tests cover the module.

### 9.2 The four live sources

| Source | Endpoint | Dialect | Notes |
|---|---|---|---|
| **ET_MARKETS** | `economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms` | RSS | No UA filtering; ~50 items/pass |
| **LIVEMINT** | `livemint.com/rss/markets` | RSS (CDATA) | ~35 items/pass. **Replaced MONEYCONTROL** — its public RSS is frozen at 23 Apr 2024 |
| **BSE_ANNOUNCEMENTS** | `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?...` | `bse` JSON | Corporate announcements — **highest-precision per-stock source** |
| **GOOGLE_NEWS** | `news.google.com/rss/search?q=(nifty OR sensex OR NSE) when:1d&hl=en-IN&gl=IN&ceid=IN:en` | RSS | Aggregator sweep, ~100 items/pass |

First live pass: 241 parsed → 124 stored (116 cross-source dupes caught), 49 symbol-mapped.

### 9.3 Fetching mechanics

- **Browser User-Agent, not a bot UA.** Moneycontrol (Akamai) and BSE's WAF return **HTTP 403** to bot-style UAs and 200 to a browser UA on the *same public URLs* (curl-verified).
- **Per-source headers.** BSE additionally requires `Referer: bseindia.com/corporates/ann.html`.
- **No-throw, per-feed isolation.** 15s timeout; failure logs a warning and returns null.
- **BSE single-day quirk → two URLs per run.** The API accepts **only single-day windows** (ranges return `{}`). `{date}` expands to **yesterday + today**, so midnight-disseminated filings are never missed. `(source,url)` unique key makes the overlap idempotent.
- **Cadence:** every 15 minutes, fires once on boot, runs regardless of market hours.

### 9.4 Parsing

- **In-house, dependency-free, tolerant.** RSS 2.0 `<item>`, Atom `<entry>`, CDATA, HTML entities, Atom `link href` variants, Google News guid-wrapped links. A malformed item is skipped, never thrown.
- **BSE dialect:** JSON `{ Table: [ { HEADLINE, NEWSSUB, NEWS_DT, DissemDT, ATTACHMENTNAME, SLONGNAME, … } ] }` plus legacy XML. **`SLONGNAME` (full company name) is prepended to the body** so the symbol mapper always sees it — BSE headlines are often boilerplate ("Intimation under Regulation 30…") with the company name only in other fields.

### 9.5 Symbol mapping — how articles get attached to stocks

**Precision over recall, by design.** The gate is "≥ 90% of matched symbols correct" — a missed mention is acceptable, a wrong tag pollutes the sentiment signal.

- **Curated alias dictionary** covering all 167 universe symbols (coverage asserted by test). Case-insensitive, word-boundary-anchored, whitespace-flexible.
- **Deliberately NOT matched:** bare tickers colliding with English words (TITAN, TRENT, OIL, SAIL); bare group names ("Tata", "Adani", "Bajaj") mapping to many members.
- **`ALIAS_EXCLUSIONS`** — negative-lookahead blocks:
  - *group prefixes* — bare `sbi` does not match "SBI **Life**" (a different universe stock), "SBI Funds/Capital/Cards…"
  - *homonym guards* — `britannia`+bridge/beach/coin, `lupin`+series, `colgate`+university, `federal bank`+fraud
  - "SBI raises rates" / "Britannia Q1" still map correctly
- **Country filter for historical GDELT** — backfill rows kept only from Indian outlets (`indianDomains.ts`).

**Measured precision:** live first-run audit **92% → 100%** (after SBI exclusions). Backfill audits: **BSE_BACKFILL 100%**, **GDELT ≥ 90%** post domain-filter + homonym guards (BRITANNIA ~50% → ~96%).

**Growth loop:** every run logs unmatched headlines + alias-coverage gaps — the dictionary is grown from this log.

### 9.6 `aliasVersion` — reproducible tagging (B15, 2026-07-20)

`symbols[]` now carries the derivation version that produced it:
```
ALIAS_VERSION = "av-" + hash(alias dictionary + exclusions + Indian-domain allowlist)
```
- `src/news/aliasVersion.ts`, +5 tests
- Stamped at **every write site** (ingest, GDELT backfill, BSE backfill, remap)
- Migration `b15_alias_version` adds the nullable column
- One-time `news:remap` stamped all **172,867** existing rows (0 retagged — the dict was unchanged, confirming the stamp is honest), idempotent on re-run

**Why it matters:** `symbols[]` had already been retroactively rewritten once (24,671 tags). A future dictionary change is now a **tracked version bump** the sentiment backtest can split/filter by, not a silent rewrite. This extends the reproducibility guarantee `weightsVersion` gives the factor pipeline to the archive.

### 9.7 Dedup — so one story isn't counted twice

```
normalize(title) = lowercase, punctuation stripped
similarity       = Jaccard token overlap
threshold        = 0.7
compared against = (a) DB titles from last NEWS_DEDUPE_WINDOW_DAYS (3)
                   (b) titles already accepted in the current run
```

Exact re-fetches are separately absorbed by the `(source,url)` unique constraint.

### 9.8 Point-in-time discipline — `availableAt` and `origin`

**The single most important rule in the archive.** An article's as-of date is **`availableAt`** — when *we* could have known it — never the feed's `publishedAt`.

| `origin` | `availableAt` derivation | Evidence strength |
|---|---|---|
| `LIVE_RSS` | `= fetchedAt` (capture time) | strongest |
| `LIVE_BSE` | `= fetchedAt` | strongest |
| `GDELT` | reconstructed: `publishedAt + conservative latency margin` | weaker |
| `BSE_BACKFILL` | exchange dissemination timestamp | strong |

Research **evaluates per-`origin` tier** (why B7/B9 report a "strong-evidence tier" separately).

Point-in-time filter (shared by backtest replay and live SQL loader):
```
keep article iff  (asOfMs − windowDays×DAY) < availableAtMs ≤ asOfMs
ageDays = (asOfMs − availableAtMs) / DAY
```
`asOfMs` is **midnight of the as-of date**, so same-day-later news is excluded — conservative for a daily swing signal. **No lookahead, strictly.**

### 9.9 FinBERT scoring (B6)

**FinBERT sidecar:** `ProsusAI/finbert` at a **pinned revision**, behind an **India-term normalizer** (crore/lakh → converted magnitudes, ₹/Rs → INR, PAT/YoY/bps/NPA → FinBERT vocabulary).

Scored fields on `news_article`:
- `sentimentScore` — pos − neg ∈ [−1, 1]
- `sentimentLabel`
- the 3 class probabilities (positive / negative / **neutral** — the neutral prob drives the confidence weight)
- `sentimentModel` — `model@revision` (**bumps never mix scoring regimes**)
- `sentimentScoredAt`

Operations:
- **Ongoing:** every ingest run ends with a no-throw scoring pass; a down sidecar leaves rows unscored and the next run catches up (5s timeout, 2 retries)
- **Backlog / model bumps:** `bun run sentiment:score` (`--rescore` wipes + re-scores)
- **v1 scope:** the **HEADLINE** is scored (bodies range absent → boilerplate). Known limitation: occasional headline-level misreads (e.g. "shares tank as SEBI opens probe" scoring weakly positive). B7's recency-weighted aggregation is the designed mitigation, not per-headline perfection.

### 9.10 B16 — Raw-payload capture (the "Bronze layer") — DONE 2026-07-20

Closes the architecture review's governing criticism: *"no raw retention — a parser bug can't be replayed against last month's feeds."*

```
fetched payload
   │  content SHA
   ▼
dedupe by SHA         # CDN-cached re-fetches just bump seenCount
   │  gzip
   ▼
spool to disk         # box disk bounded to < 1 day
   │  daily backup ships
   ▼
S3  raw/<sha>.gz      # payloads stay OUT of the pg_dump
   │
   ▼
raw_capture index row in Postgres forever
   (sha / source / url / status / bytes / s3Key)
```

- **Verified end-to-end on the box:** live fetch → 5 deduped payloads → S3 → **content-address integrity confirmed** (S3 object gunzips to bytes whose SHA == its filename)
- +4 tests · **non-fatal** (never fails ingest)
- ⚠️ **Forward-only.** Historical rows pre-B16 have no raw payload — those bytes were discarded at ingest and cannot be recovered. Any Bronze layer added late must be.

### 9.11 How articles become a per-stock score — full chain

```
raw feed item
   │  [B16] gzip + content-SHA → S3 Bronze layer
   │  parse
   ▼
article (title, body, url, publishedAt, fetchedAt)
   │  Jaccard dedup (0.7)
   ▼
unique article
   │  alias dictionary + exclusions + homonym guards  →  stamped ALIAS_VERSION
   ▼
article tagged with symbols[]  ──►  stored with availableAt + origin
   │  FinBERT (pinned revision, India-normalized)
   ▼
score ∈ [−1,1] + neutralProb + model@revision
   │  point-in-time cut: availableAt ≤ asOf, within 30d window
   ▼
per-article: recency = 0.5^(ageDays/7) ; confidence = 1 − neutralProb ; w = recency × confidence
   │  weighted mean
   ▼
mean ∈ [−1,1]  →  sentiment score = 50 + 50 × mean   (null if < 3 articles or Σw ≤ 0)
   │
   ▼
SentimentFactor 0–100  →  (production) sentimentFactorFloor 50 gate
```

### 9.12 Ingest observability

Every pass writes an `ingest_run` row (`module=NEWS`, per-source results, totals, `status: ok|degraded|failed`, alert lines) and pages the operator on Telegram.

Alert policy (unit-tested):
- **FROZEN feed → immediate**
- source failed / zero-parse / FinBERT sidecar down → on the **second consecutive** run (flap-resistant; a real outage pages within ~30 min at the 15-min cadence)

Two purpose-built alarms:
- **`newest item` + `⚠️ FROZEN?`** — flags a feed whose newest item is > 3 days old. *Item counts look perfectly healthy on a frozen feed (Moneycontrol's did); only the dates expose it.* This detector exists because that failure mode was hit in production.
- **Unmatched-headline sample** — the alias-dictionary growth queue.

---

## 10. Fundamentals — point-in-time data

**The as-of key is `announcedAt`** (BSE dissemination), with `fallbackAvailableAt = periodEnd + SEBI deadline` when unmatched.

Explicitly refuses to use `periodEnd`: a June quarter's EPS did not exist until the July announcement. This blocker was found honestly during Step 4 and the factor was **not built** until dated snapshots existed.

Tables:
- `quarterly_fundamental` — PIT quarterly EPS/profit/sales + `announcedAt` → `availableAt` (**1,984 quarters**)
- `fundamental_snapshot` — weekly as-of ratio capture (`fetchedAt` as-of key, append-only)

Source parsing: `src/fundamentals/screenerParser.ts`. Sustained over-fetching got the IP blocked in live testing — cadence is deliberately weekly.

---

## 11. Delivery % (NSE bhavcopy)

**B13 — the last untouched high-ranked free source.** 5.5-year archive (**1,433 files, 2021-01-01 → 2026-07**), backtestable immediately.

Two readings of the same daily number, **not equivalent**:

- **Level** (`deliveryPct`) — how much of today's volume settled as delivery. Weak cross-sectionally because it is **structural**: a utility or insurer sits near 60–70% every day, a high-churn momentum name near 25%. Ranking on level mostly ranks *sector and shareholding structure*.
- **Surge** (`deliveryPct ÷ its own trailing mean`) — today's delivery relative to what this stock normally does. The accumulation hypothesis proper, and the same "relative to its own baseline" idea that made SectorRelativeStrength work.

```
surgeAsOf(series, index, lookback = 20):
    baseline = mean(deliveryPct over [index−lookback, index−1])   // STRICTLY BEFORE
    surge    = deliveryPct[index] / baseline
    → null if incomplete baseline (never a partial-window guess)
```

**Point-in-time:** the bhavcopy for day D publishes after D's close, so D's own delivery is known at D's close — the same instant as D's candle. No lookahead.

**Result: NEGATIVE.** Surge is monotone and builds with horizon, but **p90 spread ≈ 0 (no right tail)**, effect ≈ trading costs, volume confound check failed. **No factor built.** Byproduct: delivery *level* is a clean volatility proxy. Second byproduct: this archive is what made the survivorship repair (§13) possible.

---

## 12. Event classification

`src/events/classify.ts` — deterministic typing of exchange filings. Current extractor version **`ev-1.1.0`**.

**13 event types** (12 original + `TRADING_WINDOW`, split out 2026-07-21):
```
EARNINGS_RESULT   EARNINGS_CALL    ORDER_WIN      RATING_ACTION
M_AND_A           DIVIDEND         BOARD_MEETING  MGMT_CHANGE
CAPITAL_ISSUE     INSIDER_PLEDGE   TRADING_WINDOW MEDIA_ROUTINE
OTHER
```

Each classification carries provenance:
```
method: 'exchange-label' | 'keyword' | 'none'
rawLabel: the raw BSE subcategory when method = 'exchange-label'
extractorVersion: 'ev-1.1.0'
```

Exchange labels preferred (BSE labels its own filings); keyword pack is the fallback.

**Result: NEGATIVE.** 57.7% of filings typed deterministically, but **no event type has a distinctively fat right tail** (p90 spans 4.1–5.9). The untyped `OTHER` baseline is itself positive, so the correct null is "a company filed something" — only 3 of 12 types clear it. `EARNINGS_RESULT` is flat.

### 12.1 The `INSIDER_PLEDGE` de-confound (2026-07-21) — B12's strongest cell, honestly killed

B12's single strongest result was `INSIDER_PLEDGE +0.82 @10d`. Suspicion: it mixed **scheduled trading-window notices** (calendar boilerplate) with **real SAST/PIT/pledge disclosures** (potential smart-money signal).

Fix: `trading window` is now tested **before** the pledge rule, splitting the two (+5 classifier tests).

**Re-run result — the cell was a calendar artifact:**
- `TRADING_WINDOW` (n = 1,294) retains the **entire** well-powered drift
- Genuine `INSIDER_PLEDGE` (n = 124) **no longer clears the baseline at 10d** (CI spans zero)

**Not a smart-money result.** This is the project pattern again: the honest test kills the exciting number.

---

## 13. Survivorship repair

**Status change: ❌ "blocked on an NSE source" → ✅ BUILT + MEASURED (2026-07-21).**

### 13.1 The block was false

The backtest replays **today's** curated 167-name universe into the past, so a name tradeable in 2021–2024 but gone now silently vanishes — survivorship bias that flatters results. Repair was thought to need historical NSE index constituents "behind a JS/WAF page." Re-examined:

- **The JS/WAF wall is only the interactive listing page.** The underlying data is static:
  - **Reconstitution press-release PDFs** — `curl` + browser UA fetches them (HTTP 200); `pypdf` parses the clean per-index "being excluded / being included" tables
  - **Historical constituent CSVs** — the **Wayback Machine** serves point-in-time snapshots of `niftyindices.com/IndexConstituent/ind_nifty200list.csv` (raw via the `…id_/` prefix), with **ISIN** — which is what makes triage reliable across renames
- **The price half was already on disk** — the B13 bhavcopy archive is the full-market daily dump. Confirmed DHFL, FRETAIL, FCONSUMER, RELCAPITAL, DISHTV, PCJEWELLER, VAKRANGEE all present on the days they traded.

### 13.2 Triage — 116 absent names, three very different buckets

Union of Nifty 200 members across 2021/2022/2023 snapshots = 261 names; **116 absent from today's 167**. Triaged by **ISIN** (survives renames):

| Bucket | Count | Meaning |
|---|---|---|
| **[1] Rename/merger already covered** | 8 | Same ISIN under a new symbol — `CADILAHC→ZYDUSLIFE`, `INFRATEL→INDUSTOWER`, `LTI→LTM`, `MCDOWELL-N→UNITDSPR`, `MOTHERSUMI→MOTHERSON`, `TATAGLOBAL→TATACONSUM`, `TATAMOTORS→TMPV`. **NOT a gap.** |
| **[2] Still in current Nifty 500, outside our 167** | 73 | ACC, ESCORTS, GLENMARK, PAGEIND, DIXON, ASTRAL… Never vanished; excluding them is a **curation choice applied consistently across time**, so **not survivorship bias**. |
| **[3] Gone from current Nifty 500** | 35 | The true survivorship tail — itself mixed: genuinely delisted (DHFL, FRETAIL, FCONSUMER, RELCAPITAL, DISHTV, PCJEWELLER, VAKRANGEE, IBVENTURES), merger successors already in universe (HDFC→HDFCBANK, MINDTREE→LTM, SRTRANSFIN→SHRIRAMFIN, GRUH→BANDHANBNK), and still-listed-but-fell-out (GSPL, GUJGASLTD, JUBLFOOD, PEL, PGHH, VGUARD, NAUKRI…). `DUMMYREL` is an NSE corporate-action placeholder, not a company. |

**Net:** roughly **a dozen** names truly vanished — but they include large 2021-era losers (DHFL, FRETAIL, RELCAPITAL), so per-name impact on a "beat Nifty" gate is high.

### 13.3 What was built

1. **`src/ohlcv/bhavcopyOhlcv.ts`** (+7 tests) — bhavcopy → OHLC parser + `backAdjustSplits`
2. **`bun run survivorship:ingest`** — ingests bhavcopy OHLCV for the **10 delisted Nifty-200 victims** as EQ instruments (**7,873 candles**). `loadCandleStore` selects EQ instruments with candles (not `EQUITY_UNIVERSE`), so they're picked up automatically. **Zero `equityUniverse.ts` change** → live universe and news alias-coverage contract untouched
3. **Point-in-time membership** — `to` = each name's **index-exit date**, bracketed by constituent snapshots (not its delisting date — see trap 3)
4. **Pre-pass membership gate** (`backtestEngine.ts`) — SRS sector-peer pre-pass + breadth honour `isMemberOn`. Baseline-neutral

### 13.4 The result — `backtest:portfolio`, B9 stack, risk sizing

| Window | Baseline (167) | Corrected (177) | Δ | Nifty B&H |
|---|---|---|---|---|
| **COVERAGE** (2024-07→, the gate) | −17.08% | **−17.08%** | **0.00** | +0.80% |
| OOS (2023-01→) | +8.41% | +7.14% | −1.27pp | +34.39% |
| FULL (2021-11→) | +4.72% | **+0.29%** | **−4.43pp** | +42.92% |

- **COVERAGE identical** — every victim had left the index by 2024, so the validated era is untouched. Confirms the pre-pass fix works *and* that survivorship doesn't reach the window B9 was validated on
- **FULL drops −4.4pp** — the honest direction: the 2021–22 hidden names dragged the deep window down. The bias was real and *was* flattering results
- **Verdict unchanged on every window.** Still trails Nifty by 30–40pp. **A survivorship-corrected backtest does NOT rescue the edge** — this removes "maybe it's just survivorship" as an explanation

### 13.5 Three traps found and fixed during verification

1. **Duplicate-row artifact.** Some bhavcopy files are stale republications of the prior day (`2022-08-31.csv` carries 2022-08-30's rows). Running `backAdjustSplits` before dedup planted a false same-date "corp action" that corrupted whole series (PEL showed a spurious −83% day). **Fix: dedup by trade date first.**
2. **Adjustment heuristic is fragile on gappy distressed data.** With missing archive days, NSE's PREV_CLOSE (always the *true* prior-session close) reads as a false split against a several-sessions-old previous row. These 10 names had **no material in-window split/bonus** (distressed companies don't split), so the ingest uses **raw deduped prices**; `backAdjustSplits` stays a tested tool for clean data. PEL's 2022 Piramal Pharma demerger is left as a real ~−45% drop (conservative).
3. **delist-date ≠ index-exit-date.** Using the delisting date as `to` let the backtest trade a name during periods it had already dropped to small-cap — e.g. **RELINFRA's +345% (2021) and 13× (by 2024) rally after it left the index in ~2022**. That is a look-ahead-style bias that made the naive first run come out *better*, not worse. **Fixed to index-exit windows.** ⚠️ Snapshots are annual, so exit is precise only to ±1 reconstitution.

---

## 14. Market regime detection

```
return1d = (nifty_close − nifty_prevClose) / nifty_prevClose × 100
breadth  = 100 × (# universe stocks with close > EMA50) / (# with enough history)

1. CRASH     if return1d ≤ −3%  OR  vix ≥ 30           → no new signals
2. HIGH_VOL  if vix ≥ 20  OR  (no vix AND niftyAtrPct ≥ 2%)
3. else by trend + breadth:
     BULL     if nifty_close > EMA200  AND  breadth ≥ 55%
     BEAR     if nifty_close < EMA200  AND  breadth ≤ 40%
     SIDEWAYS otherwise
```

**VIX precedence (B8.4):** explicit operator value → **stored India VIX** (token 99926017, staleness-guarded 5 days) → Nifty-ATR% proxy as fallback.

Breadth is **membership-gated** (§13.3) so departed names don't distort it.

---

## 15. Strategy layer — composite, gates, two configs

### 15.1 Bucket scores

**Technical bucket** = weighted mean of the directional technical factors:
```
frozen baseline:  trend 0.35 · momentum 0.30 · relativeStrength 0.25 · volume 0.10
production (B9):  trend 0.35 · momentum 0.30 · relativeStrength 0.25 ·
                  sectorRelativeStrength 0.25 · volume REMOVED
(renormalized over whichever factors are present)
```
*Volatility is non-directional → never in the composite.*

**Sentiment / Fundamental buckets** are held **explicitly empty** (`buckets.sentiment: []`, `buckets.fundamental: []`) so the regime blend stays dormant and the baseline stays byte-identical. Activation is a one-line config lever, set only on walk-forward evidence.

### 15.2 Composite — regime-weighted blend

```
regime weights (technical / sentiment / fundamental):
  BULL      0.50 / 0.30 / 0.20
  SIDEWAYS  0.35 / 0.25 / 0.40
  HIGH_VOL  0.40 / 0.45 / 0.15
  BEAR      0.30 / 0.30 / 0.40

composite = Σ(bucketScore × weight) / Σ(weight)    over PRESENT buckets
```

Since only `technical` is present, **composite = technicalScore**.

### 15.3 Agreement score
```
agreement = clamp(1 − stddev(directional factor scores) / 50, 0, 1)
```

### 15.4 Threshold (regime-adjusted)
```
threshold = 65 + adj      where adj = BULL 0 · SIDEWAYS 0 · HIGH_VOL +5 · BEAR +10
```

### 15.5 The 7 gates

All must pass; first failure is the recorded rejection reason.
```
1. regime            : regime ≠ CRASH
2. composite         : composite ≥ threshold
3. technical-floor   : technicalScore ≥ 60
4. macd-bullish      : momentum.histogram > 0
5. price-above-ema20 : close > EMA20
6. rsi-band          : 35 ≤ RSI ≤ 68
7. sentiment-floor   : sentiment ≥ 40   (only when the sentiment BUCKET is active — dormant today)
```

**Research-only gates** (absent from the frozen baseline, present in production):
- `fundamental-floor` (B5) · `sentiment-factor-floor` (B7) — reject if the factor score < floor
- `regimeGateOverrides` — per-regime gate tightening
- `disabledGates` — for leave-one-out attribution

Both floors read the **bundle directly** while the buckets stay inactive — the mechanism that lets an observational factor act as a tail-trim without activating the regime blend.

### 15.6 Two configs — critical distinction

| | `DEFAULT_STRATEGY_CONFIG` | `createProductionStrategy()` |
|---|---|---|
| Role | **frozen research baseline** — the control every experiment measures against | **what `signals:run` delivers to Telegram** (B9 stack, adopted 2026-07-20) |
| Technical weights | trend .35 · momentum .30 · RS .25 · volume .10 | trend .35 · momentum .30 · RS .25 · **SRS .25 · volume REMOVED** |
| Floor gates | none | **fundamentalFloor 50 + sentimentFactorFloor 50** |
| BULL entry | buy-strength (WeightedStrategy everywhere) | **BullPullbackStrategy** |
| `weightsVersion` | `w-fd0e1dec2aa9` | **`w-68f83d8edbf9`** |

**BullPullbackStrategy** is a decorator over `WeightedStrategy`. Off-BULL it delegates byte-for-byte. In BULL it swaps in a pullback + resumption entry:
```
RSI 40–55  AND  dip ≤ 2% above EMA20  AND  EMA stack intact  AND  MACD histogram rising
```

The baseline is **deliberately kept frozen** so research controls stay comparable across the whole program.

> ⚠️ The production config is **not an edge** — it is the least-bad *validated* config. Orders remain manual; Phase 5 stays gated.

---

## 16. Signal math — entry, stop, targets, R:R

```
entryLow  = entry × 0.995
entryHigh = entry × 1.005          // entry = last close

atrPct = ATR14 / entry × 100
  REJECT "atr-too-high"  if atrPct ≥ 6%

mult     = atrPct < 1.5 ? 2.0 : 1.5           // wider stop for calmer stocks
SL_ATR   = entry − mult × ATR14
SL_SWING = min(low over last 15) × 0.997
SL       = max(SL_ATR, SL_SWING)              // the tighter of the two
slPct    = (entry − SL) / entry × 100
  REJECT "sl-band"  if slPct < 0.5%  OR  slPct > 10%

risk    = entry − SL
target1 = entry + 2 × risk
target2 = entry + 3 × risk

resistance     = max(high over prior 60 candles, excluding today)   // null if ≤ entry (breakout)
rrToResistance = (resistance − entry) / risk
  REJECT "rr-resistance"  if resistance exists AND rrToResistance < 1.5
```

> The SL band max is **10%** (operator config; original spec said 3%). The ATR/swing computation is unchanged — stops still adapt per stock.

---

## 17. Portfolio manager — sizing and caps

```
KILL SWITCH:
  if dailyRealizedLoss ≥ dailyKillSwitch → reject ALL ("kill-switch")

SIZING (PORTFOLIO_SIZING_MODE — production = RISK):
  risk mode:        qty sized so (entry − SL) × qty ≈ fixed risk budget
  conviction mode:  allocatedCapital = baseCapitalPerTrade × (compositeScore / 100)
                    qty = floor(allocatedCapital / entry)
  size-reduction:   if 3% ≤ atrPct < 6% → qty = floor(qty × 0.75)
  REJECT "sizing"   if qty < 1

COST-DRAG:
  expectedProfit = qty × (target1 − entry)
  cost           = positionValue × roundTripCostPct / 100     // roundTripCostPct = 0.25
  REJECT "cost-drag"  if expectedProfit < 3 × cost

ALLOCATION (candidates ranked by composite desc):
  slots = maxOpenPositions − open_positions        // maxOpenPositions = 2
  REJECT "position-limit"  if slots exhausted
  REJECT "sector-cap"      if sector already at maxPerSector (1)
  else APPROVE, decrement slots, mark sector
```

> ⚙️ **Operator decision (2026-07-20):** production sizing switched **conviction → risk**, because conviction sized capital ∝ a composite measured at worse-than-random (ρ ≈ 0). Live sizing now matches the backtested model. Risk sizing gives the smallest drawdowns everywhere measured.

An `ApprovedSignal` carries: symbol, sector, regime, composite/agreement, full levels (entry band, SL, T1/T2, risk/share, R:R, atrPct), and sizing (qty, positionValue, allocatedCapital, riskAmount, sizeReduced).

---

## 18. Persistence & reproducibility stamps

Each run writes, in **one append-only transaction**:
- `SignalRun` — summary (regime, counts, version stamps)
- `Signal` — every approved signal with full levels + sizing + version stamps + `snapshotJson`
- `SignalRejection` — every dropped candidate with `stage` (strategy | signal-math | portfolio) + reason + detail

**Version stamps:**
```
snapshotSchemaVersion   = "1.0.0"
engineVersion           = git sha  (env ENGINE_VERSION → git → "dev")
weightsVersion          = "w-"  + sha256(strategy weights + thresholds)[0..12]
factorConfigChecksum    = "f-"  + sha256(all factor default configs)[0..12]
instrumentMasterVersion = "im-<universeCount>@<lastSyncDate>"
constituentSnapshotDate = asOf
```

Archive-side stamps (extending the same guarantee to data):
```
aliasVersion     = "av-" + hash(aliases + exclusions + domain allowlist)   // news_article
sentimentModel   = "model@revision"                                        // news_article
extractorVersion = "ev-1.1.0"                                              // event classification
```

Change any factor param or weight ⇒ the checksum changes ⇒ you always know exactly which config produced any signal.

---

## 19. Delivery (Telegram)

- `AlertFormatter` renders an explainable Markdown message: regime, each signal's entry band / stop (with %) / targets / qty / composite / agreement, plus a manual-order disclaimer. A no-signal run reports the regime + top rejection reasons.
- `deliverAlert` sends with **3× exponential backoff**; on final failure persists to the `UndeliveredAlert` queue (Postgres = source of truth). `resendUndelivered` flushes the backlog on the next run.
- **No-throw** — delivery never fails the pipeline. With `TELEGRAM_*` unset it logs instead of sending.

---

## 20. Backtesting machinery

### 20.1 BacktestEngine — as-of replay, no lookahead

- Loads all candles once into memory (`candleStore`), then for each trading day D reconstructs the pipeline **as of D** using candles ≤ D only
- **Signal generation separated from exit simulation** (`generateRawSignals` + `simulateSignals`) so a sweep generates signals once and cheaply re-simulates under many exit configs
- **Dedup:** fixed 5-day re-signal cooldown per stock (config-independent → signal set stable across a sweep)
- **Membership-gated pre-pass** (2026-07-21) — SRS peers + breadth honour `isMemberOn`
- **`universeType` scoping** — `EQ` vs `EQ_MID` so midcap work never touches large-cap backtests
- Measures **signal edge** — every signal taken; does NOT enforce the live 2-position/sizing caps

### 20.2 TradeSimulator — the 5 exit triggers

Entry fills at the **next day's open** (signal fires on the close). Each forward day, in priority order (SL first = conservative):

```
risk = entry − SL ;  T1 = entry + 2×risk ;  T2 = entry + 3×risk

1. stop-loss    : low ≤ SL              → exit remainder at SL
2. target1      : high ≥ T1 & !taken    → sell 50% at T1, move SL to breakeven (entry)
3. target2      : high ≥ T2             → exit remainder at T2
4. time-stop    : held ≥ 7 cal days     → exit remainder at close
5. thesis-break : 2 closes < EMA20  OR  MACD histogram flips negative → exit at close
   (end-of-data): ran out of candles    → mark out at last close
```

**Costs:** 5 bps slippage each side + 0.05% commission each side (≈ 0.10% round trip).

### 20.3 Metrics & benchmark

Per-trade **net-% returns** (sizing-agnostic): win rate, expectancy, profit factor (Σ gross wins ÷ |Σ gross losses|), max drawdown, Sharpe/Sortino (trade-level), exit-reason breakdown. Benchmark = **Nifty Buy & Hold**; for midcap work, **point-in-time equal-weight midcap B&H**.

### 20.4 Walk-forward harness

`makeExpandingFolds` + `runWalkForward`. Config selected on train, measured on unseen test, expanding folds, **embargoed**. `--from` anchors coverage-era folds. `WFCandidate` carries **exit config**, so exits are OOS-testable too.

### 20.5 Portfolio simulator — the decisive gate

One base capital, calendar sweep over precomputed trajectories; enforces caps/sizing/kill-switch; **entries-before-exits (no lookahead)**. Reports CAGR, **true** max drawdown, exposure, same-units benchmark comparison. Sizing variants: flat / conviction / risk.

**This is the gate Phase 5 reads.**

### 20.6 Other harnesses

| Script | Purpose |
|---|---|
| `backtest:sweep` | time-stop × target R-multiple grid, ranked by PF |
| `backtest:attribution` | conditioning + gate/factor leave-one-out |
| `backtest:regime` | regime-conditioned entry experiment |
| `backtest:pullback` | BULL pullback-entry experiment + OOS split |
| `backtest:phase6 [--midcap]` | embargoed/anchored walk-forward |
| `backtest:portfolio` | the "beat Nifty" gate |
| `backtest:slots` | slot allocation vs a **seeded random control** |
| `events:study` | event typing + forward-excess by event type |
| `delivery:study` | cross-sectional decile study on delivery % |
| `backtest:horizon` / `:horizon:portfolio` | holding-horizon sweep + beta-inclusive gate |
| `midcap:ingest` / `midcap:spike` | Option-B mid-cap universe test |
| `survivorship:ingest` | delisted-name OHLCV ingest |

---

## 21. All research findings, with numbers

### 21.1 The original baseline (Phase 4)

~16 months / **981 trades**:
```
Win rate      41.3%
Expectancy    −0.22% / trade
Profit factor 0.86            (< 1 = loses money)
Nifty B&H     +10.01%
Exit reasons  539 time-stop · 242 stop-loss · 172 thesis-break · ONLY 21 target2
```
**The sweep was decisive:** all **16** (time-stop × target) combos lose (PF 0.81–0.88); extending the time stop makes it worse. ⇒ **The problem is the ENTRIES, not the exits.**

### 21.2 Attribution (Step 1 / A2)

- **Nothing discriminates winners from losers** — Spearman(score, return) ≈ 0 for every factor **and the composite** (ρ = −0.02)
- **Scoring gates largely inert** — only the **RSI 35–68 band** does real filtering
- **Losses regime-linked** — BULL is the sink (397 trades, expectancy −0.67%, PF 0.61); SIDEWAYS ≈ breakeven
- **Factor ranking:** trend most, RS mild, momentum ≈ 0, **volume mildly harmful**

### 21.3 Regime entries (A5)

- **BULL is the entire negative edge.** Skipping BULL: −0.22 (PF 0.86) → **+0.06 (PF 1.04)**
- **No filter *fixes* BULL — only avoidance helps.** RSI-ceiling and sector-leadership filters make *surviving* BULL trades **worse** (−0.70 to −0.92 vs −0.67)

### 21.4 BULL pullback entry (A6)

- BULL expectancy −0.67 → **−0.21**; BULL PF 0.61 → **0.77**, at the *same* trade count (391 vs 397) — an entry improvement, not avoidance
- Overall → near-breakeven (−0.04, PF 0.97)
- A full-window "edge" claim was **exposed as in-sample optimism** by the train/test split

### 21.5 Phase 6 walk-forward (A7)

- `pullback+srs0.25` selected on **all 3 folds**
- OOS: **PF 0.78 → 0.91**, expectancy **−0.34 → −0.12** (≈ ⅓ of the loss removed)
- Still no positive edge

### 21.6 B9 joint selection — the production config

`pullback + srs0.25 + ff50 + sf50 − volume`
- Selected on **all 4 coverage-era folds × both origin tiers** — the first uniform selection
- Signal-edge OOS **−0.04 / PF 0.97** vs baseline −0.47 / 0.73
- Portfolio: FULL **+22.8%** / OOS **+24.8%** (maxDD −11%) — **first positive absolute returns**
- **On the validated COVERAGE era: −6.5% vs Nifty +0.8% → GATE FAILED**
- **Volume is out** — `-novol` in 8/8 anchored winners

### 21.7 B11 slot allocation — answered NO

No ordering (8 keys incl. sentiment/fundamental/SRS) beats a **seeded random control** on both windows. The incumbent composite ranking *loses* to a coin flip; widening slots makes it worse.

⇒ **The ~14% bottleneck is signal quality, not allocation.**

### 21.8 B12 event typing — negative (and its best cell later killed)

57.7% typed. **No event type has a distinctively fat right tail** (p90 4.1–5.9). The untyped `OTHER` baseline is itself positive — only 3 of 12 types clear it. `EARNINGS_RESULT` flat.

**2026-07-21 de-confound:** the strongest cell (`INSIDER_PLEDGE +0.82@10d`) was a **calendar artifact** — `TRADING_WINDOW` (n=1,294) keeps the whole drift; genuine `INSIDER_PLEDGE` (n=124) no longer clears baseline.

### 21.9 B13 delivery % — negative

Surge monotone and builds with horizon, but **p90 spread ≈ 0**, effect ≈ trading costs, volume confound failed. **No factor built.**

### 21.10 B14 horizon — confirmed at signal level, killed at portfolio level

Right tail appears (p90 +5.3 → +16.7, PF 1.07 → 1.42) — but mostly **market beta**; every variant still loses to a flat Nifty on the validated era.

⚠️ **A ~30-day claim was made and RETRACTED the same day** when walk-forward inverted it: 7d incumbent is best OOS; longer monotonically worse. **Keep the 7-day exit.**

### 21.11 Survivorship — bias real, verdict unchanged

FULL +4.72% → **+0.29%** (−4.4pp) · OOS +8.41% → +7.14% · **COVERAGE unchanged (−17.08%)**. Survivorship is **not** masking an edge. (See §13 and the discrepancy note in §2.)

### 21.12 Mid-cap spike (Option B) — the sixth negative

**Portfolio level**, B9 stack, risk sizing, ₹2L book:

| Window | B9 strategy | **Midcap-EWI B&H (the bar)** | Nifty B&H (ref) |
|---|---|---|---|
| FULL (2021-11→) | −24.98% | **+104.15%** | +42.92% |
| OOS (2023-01→) | −23.00% | **+94.92%** | +34.39% |
| COVERAGE (2024-07→) | −21.14% | **+6.34%** | +0.80% |

**The fair bar is the midcap segment**, not Nifty — beating Nifty-50 with midcaps in a bull tape is just beta.

**Signal-edge walk-forward** (`backtest:phase6 --midcap`, 3 embargoed folds, 8 configs, exposure-neutral):

| | test n | OOS exp% | PF |
|---|---|---|---|
| walk-forward **selected** | 1,078 | **−0.04** | **0.98** |
| baseline (control) | 1,204 | −0.09 | 0.95 |

**The decisive fact:** midcap OOS per-trade edge is **−0.04% / PF 0.98 — essentially identical to large-caps (−0.04 / PF 0.97).** At the signal level the strategy is **no better down-cap**. The "inefficiency is likelier down-cap" thesis is refuted.

The portfolio-level −120pp is real but **largely an exposure/beta confound** — a concentrated 2-slot book *cannot* track a 100%-invested basket in a +104% tape by construction. Per-fold picks churn; no config generalizes.

**Method rigour:** fixed point-in-time **2021-03 Nifty Midcap 150 cohort** (150 → 141 with bhav data), survivorship-correct (candles bounded to index-exit ±1 reconstitution), sectors normalized across NSE's drifting taxonomy, and the split-adjustment bug fixed (§6.3).

**Caveat:** technicals-only (no midcap news/fundamentals, so ff50/sf50 read neutral-50 and pass — effective strategy is `pullback+srs0.25−volume`). Config not re-tuned for midcaps. Building midcap sentiment + fundamentals was exactly the investment this cheap spike was meant to gate — **and the gate says don't.**

---

## 22. What is complete — full checklist

### Part A — the platform

| # | Item | Status |
|---|---|---|
| A1 | **Phases 1–4 platform** | ✅ |
| A2 | **Factor & gate attribution** | ✅ |
| A3 | **Doc reconciliation** — spec drift annotated `[AS-BUILT]` across ~20 docs | ✅ |
| A4 | **SectorRelativeStrengthFactor** | ✅ |
| A5 | **Fundamental blocked honestly** → redirected to regime experiments | ✅ |
| A6 | **BULL pullback + resumption entry** | ✅ |
| A7 | **Phase 6 walk-forward harness** | ✅ |
| A8 | **COMPLETE_REFERENCE.md** | ✅ |

### Phases

| Phase | Status |
|---|---|
| **1 — Data foundation** | ✅ |
| **2 — Factor layer** | ✅ |
| **2.5 — Golden determinism gate** | ✅ |
| **CI/CD** | ✅ |
| **3 — Decision layer** | ✅ |
| **4 — Backtesting** | ✅ |

### Part B — the research program

| # | Item | Status |
|---|---|---|
| B1 | **Portfolio-level backtest** — the fair "beat Nifty" gate | ✅ |
| B2 | **Wire validated config into the nightly run** | ✅ |
| B3 | **News scraper + archive** — clock #1, running since 2026-07-18 | ✅ |
| B3.5 | **Historical news backfill (GDELT)** | ✅ |
| B3.6 | **Historical BSE announcements backfill** | ✅ |
| — | **Validation gate + observability** | ✅ CLOSED |
| B4 | **Fundamentals: snapshotter + PIT backfill** — clock #2 | ✅ |
| B5 | **FundamentalFactor** | ✅ |
| B6 | **FinBERT sidecar** | ✅ |
| B7 | **SentimentFactor** | ✅ |
| B8 | **Robustness upgrades** (B8.1 deep 5.5yr window, B8.2 membership, B8.4 real India VIX) | ✅ |
| B9 | **Phase 6 rerun** — one best strategy, adopted as production | ✅ |
| B11 | **Slot-allocation research** — answered NO | ✅ |
| B12 | **Event typing + event study** | ✅ |
| B13 | **Delivery % (NSE bhavcopy)** | ✅ |
| B14 | **Longer horizon** | ✅ |
| **B15** | **Consolidation** | ✅ **essentially complete** |
| **B16** | **Raw-payload capture (Bronze layer)** | ✅ **DONE 2026-07-20** |

### B15 detail

- [x] Horizon finding walk-forward-validated → **RETRACTED**; harness gap closed
- [x] 🚨 **Archive backups — found MISSING, now automated.** There were **no backups at all** protecting 278 MB of irreplaceable data. Daily cron, completeness guard, 14-day retention, **both** custom and portable plain-SQL formats (the box is pg16; pg15 tooling cannot read custom dumps — hit for real). **Restore verified by actually restoring:** 30 benign role-GRANT errors, zero data errors, all **173,168 articles / 227,001 candles / 1,984 quarters** intact
- [x] ✅ **Offsite copy — DONE.** Daily push to S3 (`quantswing-archive-283443834610`, private/versioned/encrypted, 90-day lifecycle) via an **instance IAM role** (put-only, scoped to one bucket — **no keys on the box**; upload through `amazon/aws-cli` over IMDSv2). Non-fatal on failure. **Verified by restoring the S3 copy end-to-end** — box → S3 → scratch DB, all counts exact
- [x] ✅ **Cross-region replication** — ap-south-1 → **ap-southeast-1** (`quantswing-archive-dr-…`, role `quantswing-crr-role`), verified ~20s. **Single-account is the accepted residual**
- [x] ✅ **`aliasVersion` stamping** — 172,867 rows stamped, 0 retagged (confirming the stamp is honest)
- [x] ✅ **B16 raw-payload capture** — content-SHA dedup → gzip → S3 `raw/<sha>.gz`, `raw_capture` index row in Postgres forever. **Content-address integrity verified on the box**
- [x] ✅ **De-confound `INSIDER_PLEDGE`** (`ev-1.1.0`) — honestly killed B12's strongest cell
- [x] ✅ **Historical index-constituent data / survivorship** — the "blocked" premise was false; repair **built + measured** (§13)

### Infrastructure completed

- **473 tests** across 45 test files, `bun run typecheck` clean
- **Golden determinism gate** — 15 stocks + Nifty benchmark, ~210 candles each, frozen `asOf`; byte-identical assertion. Proven to catch drift (a one-line tweak fails 15/16 golden tests)
- **Deployed on AWS EC2** (t3.small, 5 containers)
- **Daily automated DB backups** with verified restore, **offsite to S3**, **cross-region replicated**
- **Raw Bronze layer** with content-addressed integrity

---

## 23. What is NOT done

### Hard-gated

**B10 / Phase 5 — paper trading** 🔒
- **Gate:** the portfolio-level backtest must show the strategy **beats Nifty risk-adjusted, net of costs, out-of-sample**
- **Current reading:** ❌ **still failed**
- [ ] Gate cleared
- [ ] ≥ 2-week paper trade with metrics + factor attribution logged from day 1
- [ ] Live fills vs simulated: measure real slippage, recalibrate the cost model

### Open engineering (none blocking)

- [ ] **Salience / two-tier symbol tagging** *(days)* — the mapper is precision-first, so per-stock article counts undercount. A `symbols_loose` tier (bare tickers, group words) stored *separately* from the strict tier would let research measure whether recall matters
- [ ] Exact reconstitution dates (parse the 2021 press-release PDFs) to sharpen the ±1-reconstitution window — **low value**, COVERAGE is unaffected
- [ ] Single-**account** backup residual (region axis closed; operator chose CRR over a non-AWS pull)
- [ ] Universe widening to the 73 "still in Nifty 500, outside our 167" names — a **curation decision**, explicitly *not* a survivorship fix

### The actual next move

Per `OPEN_ITEMS.md`: **there is no remaining free engineering that changes the verdict.** The next move is a **budget call (fund Option C) or a stance (accept A/D)**, not another study.

---

## 24. Known limitations

**Data & measurement**
1. **Signal-edge backtests ignore the 2-position cap** — only the portfolio simulator is benchmark-comparable
2. **Additive max-drawdown in signal-edge reports is a naive artifact** (overlapping trades summed), not a real portfolio drawdown
3. **n falls to ~53 trades** on some coverage-window horizon cells → sequencing-sensitive
4. **±1-reconstitution imprecision** in survivorship membership windows (annual snapshots)
5. **Midcap spike is technicals-only** and uses the large-cap-selected config as-is
6. **The −6.5% vs −17.08% COVERAGE discrepancy** between `B9_RERUN.md` and `SURVIVORSHIP.md` is unreconciled (§2)

**Archive integrity**
7. **Raw capture is forward-only** — pre-B16 payloads were discarded at ingest and cannot be recovered
8. **Reconstructed `availableAt`** on GDELT rows is weaker evidence than live `fetchedAt` — research must evaluate per-`origin`
9. **Single AWS account** for backups (region axis closed)

**News specifics**
10. **Headline-level signal only** — full article text is not fetched
11. **Recall deliberately sacrificed** — bare tickers, group names, ambiguous shorthand unmatched; "HDFC" alone doesn't tag HDFCBANK; index-level stories tag nothing. Per-stock counts are an **undercount**
12. **Mention ≠ subject** — "HDFC Bank among 4 book runners" tags HDFCBANK though the story is about someone else's IPO
13. **Source fragility** — all four feeds are free, unofficial-contract endpoints that can die silently (Moneycontrol's froze without any error signal)
14. **WAF/UA dependence** — one IP, no proxy rotation; a WAF policy change can cut off a source at any time
15. **BSE params can drift** — the announcements API is undocumented; params came from a devtools capture
16. **Dedup can over- and under-fire** — Jaccard 0.7 on short titles occasionally collapses two genuinely different stories, and misses rewritten duplicates
17. **`publishedAt` ≤ `fetchedAt` gap** — up to ~15 min; negligible daily, but any intraday use must respect it
18. **Google News links are redirect URLs** — fine as unique keys, useless for full-text fetching
19. **English-only sources** — regional-language coverage absent
20. **Thin-coverage-neutral biases toward large caps** — a documented design choice

**Design simplifications**
21. `instrumentMasterVersion` is best-effort
22. `snapshotJson` holds the approved signal (could carry the full factor bundle)
23. Fundamental + Sentiment buckets are empty **by choice**, not absent

---

## 25. Configuration reference

### Factor params

| Factor | Params |
|---|---|
| Trend | EMA 20 / 50 / 200, 25 pts each |
| Momentum | RSI 14, MACD 12/26/9, weights macd 0.5 / rsi 0.5 |
| RelativeStrength | lookback 60, excessCapPct 20 |
| SectorRelativeStrength | lookback 60, minPeers 3 — weight **0.25 production**, 0 baseline |
| Volume | lookback 20, priceWindow 5, convictionCap 1.0 |
| Volatility | ATR 14, idealAtrPct 1.5, rejectAtrPct 6.0, percentileLookback 100 |
| Fundamental | value 0.6 / growth 0.4, growthCapPct 40, minPeers 3 |
| Sentiment | windowDays 30, halfLifeDays 7, minArticles 3 |
| Delivery surge | lookback 20 (study only — no factor built) |

### Regime
trend EMA 200 · fast EMA 50 · bull breadth 55% · bear breadth 40% · crash drop 3% · crash VIX 30 · high-vol VIX 20 · high-vol ATR% 2.0

### Strategy
baseThreshold 65 · technicalFloor 60 · sentimentFloor 40 · RSI band 35–68 · threshold adj HIGH_VOL +5 / BEAR +10
Research levers: `fundamentalFloor` / `sentimentFactorFloor` (validated at 50) · `regimeGateOverrides` · `disabledGates`
BULL pullback: RSI 40–55 · dip ≤ 2% above EMA20 · stack intact · MACD histogram rising

### Signal math
SL band 0.5%–10% · ATR mult 2.0 (<1.5%) / 1.5 (≥1.5%) · swing lookback 15 × 0.997 · target R-multiples 2 / 3 · resistance lookback 60 · minResistanceRr 1.5 · atrRejectPct 6

### Portfolio (env)
`PORTFOLIO_BASE_CAPITAL` (₹100,000) · `PORTFOLIO_MAX_OPEN_POSITIONS` (2) · `PORTFOLIO_MAX_PER_SECTOR` (1) · `PORTFOLIO_SIZING_MODE` (**risk**) · dailyKillSwitch ₹5,000 · minReturnVsCost 3× · roundTripCostPct 0.25% · size-reduction 3–6% ATR × 0.75

### News (env)
`NEWS_INGEST_INTERVAL_MS` · `NEWS_DEDUPE_WINDOW_DAYS` (3) · `NEWS_FETCH_TIMEOUT_MS` (15000)

### Secrets (env)
`ANGELONE_*` · `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` · `DATABASE_URL` · `REDIS_*` · `RABBITMQ_URL` · `JWT_SECRET` · `ENGINE_VERSION`

---

## 26. Scripts & cron schedule

### Scripts (`bun run <name>`)

| Script | Does |
|---|---|
| `sync:instruments` | Refresh instrument master + universe |
| `backfill:ohlcv [scope] [days]` | Backfill history (`all 2000` ≈ 5.5yr = baseline) |
| `ohlcv:update` | Incremental candle update (also nightly cron) |
| `factors:eval [scope]` | Universe-wide factor scan |
| `regime:detect [vix]` | Current market regime |
| `strategy:eval [vix] [slMax]` | Full pipeline preview |
| `signal:inspect NAME` | Drill into one stock's signal math |
| `signals:run [vix]` | **Nightly run** — pipeline → persist → deliver |
| `backtest:run` | Historical replay + report vs Nifty B&H |
| `backtest:sweep` | Parameter sensitivity sweep |
| `backtest:attribution [tier]` | Factor/gate attribution |
| `backtest:regime` | Regime-conditioned entry experiment |
| `backtest:pullback` | BULL pullback-entry experiment |
| `backtest:phase6 [tier] [--from D] [--folds N] [--midcap]` | Embargoed walk-forward |
| `backtest:portfolio [tier]` | **The decisive "beat Nifty" gate** |
| `backtest:slots [tier]` | Slot allocation vs seeded random control |
| `events:study [horizon]` | Event typing + forward-excess study |
| `bhavcopy:download` / `delivery:study` | NSE delivery-% archive + decile study |
| `backtest:horizon` / `:horizon:portfolio` | Holding-horizon sweep + portfolio gate |
| **`survivorship:ingest`** | Ingest delisted-name OHLCV from bhavcopy |
| **`midcap:ingest`** | Ingest point-in-time Nifty Midcap 150 cohort |
| **`midcap:spike`** | Option-B midcap test (read-only) |
| `news:ingest` | Manual news ingest + report (also 15-min cron) |
| `news:gal:download` / `news:gal:import` | GDELT bulk media backfill |
| `news:backfill` / `news:backfill:universe` | GDELT DOC API backfill (throttled) |
| `news:backfill:bse` | BSE announcements historical backfill |
| `news:remap` | Domain-aware re-tag + `aliasVersion` stamp |
| `sentiment:score` | FinBERT scoring catch-up (`--rescore` on model bumps) |
| `fundamentals:backfill` / `:snapshot` / `:retry` | Point-in-time fundamentals |
| `golden:snapshot` / `golden:update` | Refresh / re-baseline golden fixture |
| `test`, `typecheck` | 473 tests; strict tsc |

### Cron (RabbitMQ-backed, IST)

| Time | Job |
|---|---|
| 08:00 | Instrument master sync |
| 16:00 | Post-market cleanup (legacy OMS) |
| 16:30 | OHLCV incremental update |
| **17:00** | **Nightly signal run → persist → Telegram** |
| every 15 min | News ingest (4 sources) + FinBERT scoring + raw capture |
| every 7 days | Fundamentals snapshot (fires on boot) |
| daily | DB backup (14-day retention, dual format) → **S3** → **cross-region replica**; raw payload shipping |

⚠️ The EC2 box is a **burstable t3.small** — run CPU-heavy backtests and imports on a workstation, not the VM.

---

## 27. Database schema

### Research / decision tables

| Table | Role |
|---|---|
| `instrument` | Universe: token, symbol, name, sector, lot/tick, `lastPrice`, `volume` |
| `ohlcv` | Daily candles `(instrumentId, tradeDate)`, append-only |
| `signal_run` | One nightly run — regime, counts, engine/weights versions |
| `signal` | Approved signals — levels, sizing, scores, snapshot, version stamps |
| `signal_rejection` | Every rejected candidate — stage + reason + detail |
| `undelivered_alert` | Failed Telegram alerts awaiting resend |
| `app_config` | KV config (incl. `UNIVERSE_MEMBERSHIP`) |

### Research-data tables (Part B)

| Table | Role |
|---|---|
| `news_article` | source, url, title, `symbols[]`, **`aliasVersion`**, `publishedAt`, `fetchedAt`, **`availableAt`** (as-of key), **`origin`**, FinBERT score + `model@revision` |
| **`raw_capture`** | **[B16]** content-SHA index of every fetched payload — sha / source / url / status / bytes / `s3Key` / `seenCount`. Bytes live in S3 `raw/<sha>.gz` |
| `ingest_run` | Per-pass ingest observability |
| `quarterly_fundamental` | PIT quarterly EPS/profit/sales + `announcedAt` → `availableAt` |
| `fundamental_snapshot` | Weekly as-of ratio capture, append-only |

### Migrations added since the last snapshot
- `20260720000000_b15_alias_version` — nullable `aliasVersion` on `news_article`
- `20260720120000_b16_raw_capture` — `raw_capture` table

### Legacy OMS tables

`order`, `position`, `trade_setup`, `broker_token`, `broker_log`, … — the research pipeline is **independent** of them.

Notable invariants: `Position` never stores held quantity (derived from COMPLETED orders); Indian F&O charge stamping (STT, stamp duty, SEBI, GST); `BrokerLog` audit trail. Only `PAPER` broker exists.

> ⚠️ `BrokerToken.token` is stored **plaintext** (TODO acknowledged in code). Acceptable while paper-only; a security issue the moment a real broker is wired.

---

## 28. Glossary of concepts used

| Concept | Meaning in this system |
|---|---|
| **As-of date** | The date we could have known something. The single most-enforced discipline. |
| **Point-in-time (PIT)** | Data reconstructed as it existed on a past date — `availableAt` for news, `announcedAt` for fundamentals. Never `publishedAt`, never period-end. |
| **Lookahead bias** | Using information not yet available at decision time. Structurally prevented by `candles ≤ asOf` and PIT filters. |
| **Survivorship bias** | Universe = today's constituents. **Repaired and measured (§13):** −4.4pp on the deep window, COVERAGE unaffected. |
| **Index-exit vs delist date** | The correct membership boundary is when a name *left the index*, not when it delisted. Using the latter creates a look-ahead-style bias (RELINFRA trap). |
| **Golden test / determinism gate** | Frozen fixture asserting byte-identical factor output. Any change fails CI until consciously re-baselined. |
| **Composite** | Regime-weighted blend of bucket scores; the ranking number. Measured at ρ ≈ 0 vs returns. |
| **Agreement** | `1 − stddev(factor scores)/50` — how much the factors concur. Uncalibrated. |
| **Regime** | BULL / BEAR / SIDEWAYS / HIGH_VOL / CRASH from Nifty trend + breadth + VIX. |
| **Breadth** | % of universe above its EMA50 (membership-gated). |
| **Expectancy** | Average net % return per trade. |
| **Profit factor (PF)** | Σ gross wins ÷ \|Σ gross losses\|. < 1 = loses money. |
| **R-multiple** | Target expressed in units of risk (`entry − SL`). T1 = 2R, T2 = 3R. |
| **Walk-forward** | Config selected on train window, measured on unseen test window, expanding folds, embargoed. |
| **Embargo** | Gap between train and test to prevent leakage across the boundary. |
| **Anchored folds** | Folds pinned to the coverage era (`--from`) so validation happens where the data supports it. |
| **Observational factor** | Computed into every bundle but weight 0 / empty bucket — keeps the baseline byte-identical until walk-forward evidence graduates it. |
| **Floor gate** | Reject if a factor score < floor. Reads the bundle directly while the bucket stays dormant. The mechanism both orthogonal factors earned. |
| **Coverage era** | The window where news/fundamental coverage is real (≈ 2024-07 → 2026-07). The honest validation window. |
| **Origin tier** | Grouping by evidence strength of `availableAt` (live-captured vs reconstructed). |
| **`aliasVersion`** | Hash of the alias dictionary + exclusions + domain allowlist, stamped on every `symbols[]` write — makes tagging reproducible and version-splittable. |
| **Bronze layer** | Immutable raw-payload retention (content-addressed, gzipped, in S3) so a parser bug can be replayed against historical feeds. |
| **Chase-decay** | Recency weighting `0.5^(age/halfLife)` so stale news counts less. |
| **Jaccard similarity** | Token-overlap measure used for headline dedup (threshold 0.7). |
| **Selection test** | Measuring a factor by *what it removes* from the trade set, rather than by rank correlation. Revealed SRS's value where conditioning showed ρ ≈ 0. |
| **Leave-one-out (LOO)** | Disable one gate/factor and re-measure — the attribution method. |
| **Seeded random control** | A coin-flip baseline the composite ranking must beat. It didn't. |
| **PEAD** | Post-earnings-announcement drift. Structurally invisible without paid consensus estimates — the Option C target. |
| **Delivery %** | Share of traded volume settled as delivery. Level = structural; surge = relative to own baseline. |
| **Exposure/beta confound** | A concentrated 2-slot book cannot track a 100%-invested basket in a rising tape — why the midcap portfolio −120pp overstates selection failure and the walk-forward is the fair read. |
| **Thesis break** | Exit trigger: 2 closes below EMA20, or MACD histogram flips negative. |
| **Kill switch** | Daily realized-loss limit that rejects all new signals. |
| **Signal edge vs portfolio gate** | Per-trade PF is necessary; portfolio CAGR vs benchmark is what actually decides Phase 5. |

---

*Generated from repo snapshot `93cbb86` (2026-07-21). Authoritative in-repo sources: `docs/SYSTEM.md` (all math), `docs/ROADMAP_CHECKLIST.md` (task state), `docs/OPEN_ITEMS.md` (the fork + open tail), `docs/SURVIVORSHIP.md`, `docs/MIDCAP_SPIKE.md`, `docs/OPTION_C_ESTIMATES.md`, `docs/COMPLETE_REFERENCE.md`, `docs/START_HERE.md`.*
