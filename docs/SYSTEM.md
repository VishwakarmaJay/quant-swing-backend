# QuantSwing — System Overview (Zero → Phase 4, + the Part-B research program)

A deterministic, explainable quantitative decision-support system for Indian equities
(NSE). It scans a ~166-stock universe every evening and produces **ranked, gated,
risk-sized trade signals** with a full reproducibility trail, delivered to Telegram.
Orders are placed **manually** by the operator — this is decision support, not an
execution bot.

> **Design creed:** every number is reproducible from stored data + versioned config.
> No randomness, no wall-clock reads inside factor logic, every rejection has a reason.

> **Scope note.** §§1–12 document the Phase 1–4 platform and its math, which is still
> exactly what runs. Work since then (Part B: news archive, fundamentals, FinBERT,
> and two new factors) added *data and observational factors*, not new decision math —
> see §13 for current state and [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) for the
> live tracker. **Two strategy configs now exist** (§6.2a): a frozen research baseline
> and the production config the nightly run actually uses.

---

## Table of contents

1. [The pipeline at a glance](#1-the-pipeline-at-a-glance)
2. [Tech stack](#2-tech-stack)
3. [Phase 1 — Data foundation](#3-phase-1--data-foundation)
4. [Phase 2 — The factor layer (with exact math)](#4-phase-2--the-factor-layer-with-exact-math)
5. [Phase 2.5 — Golden determinism gate](#5-phase-25--golden-determinism-gate)
6. [Phase 3 — The decision layer (with exact math)](#6-phase-3--the-decision-layer-with-exact-math)
7. [Phase 4 — Backtesting (with exact math + the key finding)](#7-phase-4--backtesting-with-exact-math)
8. [Database schema](#8-database-schema)
9. [Configuration reference](#9-configuration-reference)
10. [Scripts & scheduled jobs](#10-scripts--scheduled-jobs)
11. [CI/CD](#11-cicd)
12. [End-to-end worked example](#12-end-to-end-worked-example)
13. [Roadmap status & where to go next](#13-roadmap-status--where-to-go-next)

---

## 1. The pipeline at a glance

```
Angel One (scrip master + historical candles + live LTP)
        │
        ▼
 Instrument master ──► Universe (166 equities + 3 indices)
        │
        ▼
 OHLCV store (daily candles)  ◄── nightly incremental update
        │
        ▼
 DataQualityService  ──► StockContext (candles ≤ asOf, no lookahead, + Nifty benchmark)
        │
        ▼
 8 Factors ──► FeatureBundle (immutable, deep-frozen)
        │       [4 directional in the composite · Volatility feeds signal math ·
        │        SectorRelativeStrength weighted 0.25 in PRODUCTION only ·
        │        Fundamental + Sentiment computed but OBSERVATIONAL (empty buckets)]
        │
        ▼
 MarketRegimeService (Nifty trend + breadth + VIX)
        │
        ▼
 WeightedStrategy (regime-weighted composite + 7 gates) ──► TradeCandidate | Rejection
        │
        ▼
 Signal math (ATR stop, targets, R:R)                   ──► levels | Rejection
        │
        ▼
 PortfolioManager (conviction sizing, caps, kill switch) ──► ApprovedSignal | Rejection
        │
        ▼
 Persistence (SignalRun + Signal + SignalRejection, version-stamped)
        │
        ▼
 Delivery (AlertFormatter → Telegram, retry → undelivered queue)
```

Each stage is a **pure function of injected inputs** (candles, regime, config) plus a
thin I/O “builder” that loads data. This is what makes the system deterministic and
unit-testable: the same inputs always produce byte-identical outputs.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | **Bun** + **TypeScript** (strict) |
| HTTP | Express 5 (internal `/health`) |
| DB | **PostgreSQL** via **Prisma** ORM + Prisma Migrate |
| Cache / live LTP | **Redis** (`ltp:<id>` keys, pub/sub) |
| Jobs / cron | **RabbitMQ** durable queues + interval pollers |
| Market data | **Angel One SmartAPI** (scrip master, historical candles, WebSocket LTP) |
| Delivery | **Telegram Bot API** |
| Tests | `bun:test` (unit + golden), Testcontainers-ready |
| CI/CD | GitHub Actions (typecheck + test) + Docker image → ghcr.io |
| Sentiment scoring | **FinBERT sidecar** — FastAPI + ProsusAI/finbert at a pinned revision, CPU, localhost-only (ADR-0006) |
| Deployment | One EC2 t3.small, five containers via `docker-compose` ([`DEPLOYMENT_AWS.md`](./DEPLOYMENT_AWS.md)) |

All indicator math is **in-house** (no external TA library) so it is versioned,
auditable, and golden-tested.

---

## 3. Phase 1 — Data foundation

### 3.1 Instrument master & universe
- `syncInstrumentMaster` downloads the Angel One scrip master JSON and filters it to the
  platform universe:
  - **166 NSE equities** (`instrumentType = 'EQ'`) grouped into **23 sectors**
    (`src/universe/equityUniverse.ts`, committed reference data).
  - **3 index rows** (`AMXIDX`): NIFTY, BANKNIFTY, SENSEX (used as benchmark + regime).
  - Index options (`OPTIDX`) for the legacy OMS.
- Corporate-action aliases are handled explicitly (e.g. `ZOMATO → ETERNAL`,
  `LTIM → LTM`, `TATAMOTORS → TMCV + TMPV`); symbols that don't resolve are **reported,
  never silently dropped**.
- Equity tick sizes are converted paise → ₹ (`tick_size / 100`).
- Each equity carries its **sector** (used later for RS peer group + 1-per-sector cap).

### 3.2 OHLCV store
- `Ohlcv` table: daily candles keyed on `(instrumentId, tradeDate)`, `Float` prices +
  volume, **append-only via upsert** (re-fetch overwrites in place, never duplicates).
- **Backfill** (`backfill:ohlcv`): fetches ~400 calendar days (~270 trading days) of
  history per instrument from Angel's `getCandleData`. This gives comfortable margin
  over EMA200 (needs 200) and the RS lookback (needs 61).
- **Nightly incremental** (`OHLCV_INCREMENTAL` cron, 16:30 IST): for every instrument
  that already has history, fetches forward from its last stored candle and upserts.
  Overlapping the last day re-settles a candle first captured mid-session.

### 3.3 DataQualityService — the choke point
Factors never see bad data. Before feature extraction, each candle series is scored:

```
malformed(c)  = any(o,h,l,c ≤ 0) OR volume < 0 OR high < low
                OR high < max(open,close) OR low > min(open,close)

continuity    = min(1, present_candles / (weekdays_in_span × tradingDayFraction))
                where tradingDayFraction = 0.94  (≈ 1 − holiday ratio)

stalenessDays = asOf − last_candle_date  (calendar days)

score = continuity × (1 − malformedRatio)
        × (stale ? 0.5 : 1)          // stale if stalenessDays > 5
        × (tooShort ? 0.5 : 1)       // tooShort if candles < 200
```

A score **< 0.8** means the instrument is skipped for the run. Index candles have
`volume = 0` (legitimate — spot indices have no traded volume), which is *not* malformed.

---

## 4. Phase 2 — The factor layer (with exact math)

### 4.1 Contracts

```typescript
interface Factor {
  name: string;
  category: FactorCategory;                 // TREND | MOMENTUM | RELATIVE_STRENGTH | VOLUME | VOLATILITY | ...
  evaluate(ctx: StockContext): FactorOutput; // PURE — no clock/random/env
}

type FactorOutput = {
  score: number;                 // 0–100, higher = more bullish
  agreementContribution: number; // directional lean in [−1, +1]
  explanations: string[];        // human-readable reasons
  metrics: Record<string, MetricValue>; // raw values (ema, rsi, atr, …)
};

type StockContext = {
  symbol: string;
  asOf: string;                  // ISO date — injected, never wall clock
  candles: Candle[];             // ascending, ≤ asOf (no lookahead)
  dataQualityScore: number;
  sector: string | null;
  benchmark: { symbol: 'NIFTY'; candles: Candle[] } | null;
};
```

The **runner** (`buildFeatureBundle`) times each factor and attaches `executionTimeMs`
to form the `FactorResult`, then **deep-freezes** the bundle. Timing lives outside
`evaluate` so factor output stays byte-identical across runs.

### 4.2 Indicators (in-house, exact formulas)

**EMA (SMA-seeded)** — period `p`:
```
EMA[p−1] = SMA(values[0..p−1])
k        = 2 / (p + 1)
EMA[i]   = (value[i] − EMA[i−1]) × k + EMA[i−1]     for i ≥ p
```

**RSI (Wilder smoothing)** — period `p` (default 14):
```
seed:  avgGain = mean(gains over first p changes)
       avgLoss = mean(losses over first p changes)
step:  avgGain = (avgGain × (p−1) + gain_i) / p
       avgLoss = (avgLoss × (p−1) + loss_i) / p
RS   = avgGain / avgLoss
RSI  = 100 − 100 / (1 + RS)     (avgLoss = 0 ⇒ RSI = 100)
```

**MACD** — fast 12, slow 26, signal 9:
```
macdLine = EMA(close, 12) − EMA(close, 26)
signal   = EMA(macdLine, 9)
histogram = macdLine − signal
```

**ATR (Wilder)** — period 14:
```
TR[i]  = max(high[i]−low[i], |high[i]−close[i−1]|, |low[i]−close[i−1]|)
ATR[p] = mean(TR[1..p])
ATR[i] = (ATR[i−1] × (p−1) + TR[i]) / p
```

### 4.3 The factors (8 built; what each contributes differs — see §6.2/§6.2a)

| Factor | Status |
|---|---|
| Trend, Momentum, RelativeStrength, Volume | in the directional technical composite |
| Volatility | non-directional — feeds signal math / sizing, never the composite |
| SectorRelativeStrength | weight **0.25 in the production config**; 0 in the frozen baseline |
| Fundamental (B5), Sentiment (B7) | built + computed into every bundle, **observational** (empty buckets) |

Each factor is 0–100 (higher = more bullish) with `agreementContribution = (score−50)/50`
unless noted. All parameters are config, not literals.

#### TrendFactor — EMA 20/50/200 stack
Awards 25 points per satisfied condition (sum = 100):
```
+25 if price > EMA20
+25 if EMA20 > EMA50
+25 if EMA50 > EMA200
+25 if price > EMA200
```
100 = perfect bullish stack, 0 = perfect bearish stack.

#### MomentumFactor — MACD + RSI (50/50 blend)
```
macdScore = (macd > 0 ? 50 : 0) + (histogram > 0 ? 50 : 0)   // 0 / 50 / 100
rsiScore  = clamp(RSI, 0, 100)                               // RSI used directly
score     = 0.5 × macdScore + 0.5 × rsiScore
```
Overbought filtering is the *strategy's* job (its RSI gate), not this factor's — a
momentum factor reports strong momentum, it doesn't mean-revert it.

#### RelativeStrengthFactor — vs Nifty (lookback 60)
```
stockRet = (close_now − close_60ago) / close_60ago × 100
benchRet = same for NIFTY
excess   = stockRet − benchRet
norm     = clamp(excess / excessCapPct, −1, +1)   // excessCapPct = 20
score    = 50 + norm × 50
```
Outperforming Nifty by ≥ 20% over 60 days → 100; underperforming by ≥ 20% → 0.

#### SectorRelativeStrengthFactor — rank within sector (lookback 60) — *observational (weight 0)*
```
selfRet    = 60d return of this stock
peerRets   = 60d returns of every equity in this stock's sector (cross-sectional pre-pass)
percentile = (peers_below + 0.5 × peers_equal) / peerCount     // tie-safe mid-rank
score      = percentile × 100
```
The cross-sectional half of relative strength: not "is it beating the market" (RS-vs-Nifty) but
"does it lead or lag the stocks it trades alongside." Peer returns are injected via
`ctx.sectorPeers` by a pre-pass in the runner (backtest loop / `loadSectorPeerReturns` for live),
so `evaluate` stays pure. Neutral 50 when < 3 peers or history too short.

> **Status: built but NOT yet in the composite** (`technicalFactorWeights` has no entry for it, so
> it doesn't affect live signals). It is computed into every FeatureBundle for measurement. The
> Step-1 attribution *selection test* shows adding it at weight ≈0.25 improves backtested expectancy
> (−0.22 → −0.13) and PF (0.86 → 0.92) by dropping sector laggards — the first orthogonal signal
> that measurably helps. The weight is **deferred to Phase 6** (joint learned weighting). See
> `ATTRIBUTION.md`.

#### VolumeFactor — volume-confirmed direction
```
baseVol   = SMA(volume, 20)                 // the "20-day average"
recentVol = SMA(volume, 5)
relVol    = recentVol / baseVol
recentRet = (close − close_5ago) / close_5ago
dir       = sign(recentRet)                 // −1 / 0 / +1
conviction = clamp((relVol − 1) / convictionCap, 0, 1)   // convictionCap = 1 (2× avg = full)
score     = 50 + dir × conviction × 50
```
Volume **amplifies** the price direction, never flips it: up-move on heavy volume →
toward 100 (accumulation); down-move on heavy volume → toward 0 (distribution);
average/thin volume → 50 (move unconfirmed). Index rows (volume 0) return the
insufficient branch.

#### VolatilityFactor — ATR% favorability (non-directional)
```
atrPct = ATR14 / close × 100
score  = 100                              if atrPct ≤ idealAtrPct (1.5)
       = 0                                if atrPct ≥ rejectAtrPct (6.0)
       = 100 × (reject − atrPct)/(reject − ideal)   otherwise (linear)
```
`agreementContribution = 0` always (volatility isn't bull or bear). The ATR percentile
(mid-rank, tie-safe) is exposed as an informational metric. This factor's `atr`/`atrPct`
feed the downstream stop/size rules.

---

## 5. Phase 2.5 — Golden determinism gate

- A **fixed, committed fixture** of real candles for 15 stocks + the Nifty benchmark
  (`__fixtures__/golden-candles.json`, ~210 candles each, frozen at a fixed `asOf`).
- `golden-expected.json` holds the exact factor output those inputs must produce.
- The golden test asserts **byte-identical** output (score, agreement, explanations,
  metrics — everything except `executionTimeMs`). Any factor change that shifts a number
  fails CI until re-baselined (`bun run golden:update`) with justification.
- Proven to catch drift: a one-line factor tweak fails 15/16 golden tests.

---

## 6. Phase 3 — The decision layer (with exact math)

### 6.1 MarketRegimeService
Classifies the market as of `asOf` from Nifty trend, **breadth** (% of the equity
universe above its EMA50), and VIX (optional — Nifty ATR% proxy when absent). Priority:

```
return1d = (nifty_close − nifty_prevClose) / nifty_prevClose × 100
breadth  = 100 × (# universe stocks with close > EMA50) / (# with enough history)

1. CRASH     if return1d ≤ −3%  OR  vix ≥ 30           → no new signals
2. HIGH_VOL  if vix ≥ 20  OR  (no vix AND niftyAtrPct ≥ 2%)
3. else based on trend + breadth:
     BULL     if nifty_close > EMA200  AND breadth ≥ 55%
     BEAR     if nifty_close < EMA200  AND breadth ≤ 40%
     SIDEWAYS otherwise
```

### 6.2 WeightedStrategy — "is this a good trade?"

**Bucket scores.** Factors group into 3 buckets; each bucket = mean of its present
factors:
- `technical` = weighted mean of the 4 *directional* technical factors:
  ```
  weights: trend 0.35, momentum 0.30, relativeStrength 0.25, volume 0.10
  (renormalized over whichever factors are present)
  ```
  *(Volatility is non-directional → not in the composite; it feeds signal math.)*
- `sentiment`, `fundamental` = null today (those factors are later sprints).

**Composite** — regime-weighted blend, **renormalized over present buckets**:
```
regime weights (technical / sentiment / fundamental):
  BULL      0.50 / 0.30 / 0.20
  SIDEWAYS  0.35 / 0.25 / 0.40
  HIGH_VOL  0.40 / 0.45 / 0.15
  BEAR      0.30 / 0.30 / 0.40

composite = Σ(bucketScore × weight) / Σ(weight)   over present buckets
```
Only `technical` is a *present* bucket, so **composite = technicalScore**. The Sentiment
and Fundamental factors are now **built** (B5/B7), but their buckets are held explicitly
empty (`buckets.sentiment: []`, `buckets.fundamental: []`) so the blend stays dormant and
the baseline stays byte-identical — a listed factor would auto-activate the regime blend.
Activation is a one-line config lever, set only on walk-forward evidence (B9).

**Agreement score** (uncalibrated factor agreement):
```
agreement = clamp(1 − stddev(directional factor scores) / 50, 0, 1)
```

**Threshold** (regime-adjusted): `65 + adj` where `adj` = BULL 0, SIDEWAYS 0,
HIGH_VOL +5, BEAR +10.

**The 7 gates** (all must pass; first failure = rejection reason):
```
1. regime            : regime ≠ CRASH
2. composite         : composite ≥ threshold
3. technical-floor   : technicalScore ≥ 60
4. macd-bullish      : momentum.histogram > 0
5. price-above-ema20 : close > EMA20
6. rsi-band          : 35 ≤ RSI ≤ 68
7. sentiment-floor   : sentiment ≥ 40   (only when the sentiment BUCKET is active —
                                         dormant today, so this gate never fires)
```
Gate 6's *reward:risk* form is realized by signal math (below). Two further gates exist
but are **absent from both shipped configs**, used only by research tooling:
`fundamental-floor` (B5) and `sentiment-factor-floor` (B7) — reject a factor score below
a floor, reading the bundle directly while the bucket stays inactive; both floors at 50
are jointly validated in the B9 stack but unadopted — and the per-regime
`regimeGateOverrides` tightening (Step 4).

### 6.2a Two configs: the frozen baseline vs what production actually runs

**This distinction governs how to read every number in this document.** Since B2 the
nightly run does *not* use `DEFAULT_STRATEGY_CONFIG`:

| | `DEFAULT_STRATEGY_CONFIG` | `createProductionStrategy()` |
|---|---|---|
| Role | **frozen research baseline** — the control every attribution / regime / phase6 / portfolio experiment measures against | **what `signals:run` delivers to Telegram** (the B9 stack, adopted 2026-07-20) |
| Technical weights | trend .35 · momentum .30 · relativeStrength .25 · volume .10 | trend .35 · momentum .30 · relativeStrength .25 · **sectorRelativeStrength .25 · volume REMOVED** (B9 pruning) |
| Floor gates | none | **fundamentalFloor 50 + sentimentFactorFloor 50** (tail-trims off the bundle; buckets stay dormant) |
| BULL entry | buy-strength (WeightedStrategy everywhere) | **BullPullbackStrategy** — pullback + resumption in BULL, delegates to WeightedStrategy off-BULL (RSI 40–55, dip ≤2% above EMA20, stack intact, MACD histogram rising) |
| `weightsVersion` | `w-fd0e1dec2aa9` | **`w-68f83d8edbf9`** (was `w-6edfeb770e4a` pre-B9) |

The baseline is deliberately **kept frozen** so the research controls stay intact and
comparable across the whole program; production carries the B9 stack
(`pullback+srs0.25+ff50+sf50-novol`) that the anchored walk-forward selected on all 4
coverage-era folds × both tiers ([`B9_RERUN.md`](./B9_RERUN.md)). Code:
`src/strategy/productionStrategy.ts` (pinned by `productionStrategy.test.ts`), wired into
`runPipeline`.

⚠️ This is **not** an edge — it is the least-bad validated config. Orders remain manual and
Phase 5 stays gated (§13).

### 6.3 Signal math — entry, stop, targets, R:R

For a passing candidate (`entry` = last close):
```
entryLow  = entry × 0.995
entryHigh = entry × 1.005

atrPct = ATR14 / entry × 100
  REJECT "atr-too-high"  if atrPct ≥ 6%

mult    = atrPct < 1.5 ? 2.0 : 1.5           // wider stop for calmer stocks
SL_ATR  = entry − mult × ATR14
SL_SWING = min(low over last 15) × 0.997
SL      = max(SL_ATR, SL_SWING)              // the tighter of the two
slPct   = (entry − SL) / entry × 100
  REJECT "sl-band"  if slPct < 0.5%  OR  slPct > 10%

risk    = entry − SL
target1 = entry + 2 × risk
target2 = entry + 3 × risk

resistance = max(high over prior 60 candles, excluding today)   // null if ≤ entry (breakout)
rrToResistance = (resistance − entry) / risk
  REJECT "rr-resistance"  if resistance exists AND rrToResistance < 1.5
```
> **Note:** the SL band max was set to **10%** (from the docs' 3%) per operator config;
> the ATR/swing computation is unchanged — stops still adapt per stock.

### 6.4 PortfolioManager — "can we take it now?"

Order of checks: kill switch → per-candidate viability → rank-order allocation.

```
KILL SWITCH:  if dailyRealizedLoss ≥ dailyKillSwitch → reject ALL ("kill-switch")

SIZING (conviction-based, no capital cap):
  allocatedCapital = baseCapitalPerTrade × (compositeScore / 100)
  qty              = floor(allocatedCapital / entry)
  size-reduction:  if 3% ≤ atrPct < 6% → qty = floor(qty × 0.75)
  REJECT "sizing"  if qty < 1

COST-DRAG:
  expectedProfit = qty × (target1 − entry)
  cost           = positionValue × roundTripCostPct/100   (roundTripCostPct = 0.25)
  REJECT "cost-drag"  if expectedProfit < 3 × cost

ALLOCATION (candidates ranked by composite desc):
  slots = maxOpenPositions − open_positions       (maxOpenPositions = 2, runtime-configurable)
  REJECT "position-limit"  if slots exhausted
  REJECT "sector-cap"      if sector already at maxPerSector (1)
  else APPROVE, decrement slots, mark sector
```
`baseCapitalPerTrade` and `maxOpenPositions` (+ `maxPerSector`) are **runtime env vars**
(`PORTFOLIO_BASE_CAPITAL`, `PORTFOLIO_MAX_OPEN_POSITIONS`, `PORTFOLIO_MAX_PER_SECTOR`) —
set per run/deploy, no code change.

An `ApprovedSignal` carries: symbol, sector, regime, composite/agreement, full levels
(entry band, SL, T1/T2, risk/share, R:R, atrPct), and sizing (qty, positionValue,
allocatedCapital, riskAmount, sizeReduced).

### 6.5 Persistence — the reproducibility trail
Each run writes, in **one append-only transaction**:
- `SignalRun` — summary (regime, counts, version stamps).
- `Signal` — every approved signal with full levels + sizing + **version stamps** +
  `snapshotJson`.
- `SignalRejection` — every dropped candidate with `stage` (strategy | signal-math |
  portfolio) + reason + detail.

**Version stamps** (make any historical signal reconstructable):
```
snapshotSchemaVersion   = "1.0.0"
engineVersion           = git sha  (env ENGINE_VERSION → git → "dev")
weightsVersion          = "w-" + sha256(strategy weights + thresholds)[0..12]
factorConfigChecksum    = "f-" + sha256(all 5 factor default configs)[0..12]
instrumentMasterVersion = "im-<universeCount>@<lastSyncDate>"
constituentSnapshotDate = asOf
```
Change any factor param or weight ⇒ the checksum changes ⇒ you always know exactly which
config produced any signal.

### 6.6 Delivery
- `AlertFormatter` renders an explainable Telegram (Markdown) message: regime, each
  signal's entry band / stop (with %) / targets / qty / composite / agreement, and a
  manual-order disclaimer. A no-signal run reports the regime + top rejection reasons.
- `deliverAlert`: sends with **3× exponential backoff**; on final failure persists to
  the `UndeliveredAlert` queue (Postgres = source of truth). `resendUndelivered` flushes
  the backlog on the next run. **No-throw** — delivery never fails the pipeline; when
  `TELEGRAM_*` env vars are unset it logs the alert instead of sending.

---

## 7. Phase 4 — Backtesting (with exact math)

Replays the whole pipeline over history to answer the only question that matters:
**does the strategy have edge?**

### 7.1 BacktestEngine — as-of-date replay (no lookahead)
- Loads all candles once into memory (`candleStore`), then for each trading day D
  reconstructs the pipeline **as of D** using candles ≤ D only (**no lookahead**):
  regime (breadth from that day's slices) → factors → strategy → signal math.
- Signal generation is **separated from exit simulation** (`generateRawSignals` +
  `simulateSignals`) so a parameter sweep generates signals once (the expensive replay)
  and cheaply re-simulates them under many exit configs.
- Dedup: a fixed 5-day re-signal cooldown per stock (config-independent → the signal set
  is stable across a sweep). Measures **signal edge** — every signal is taken; it does
  NOT enforce the live 2-position / sizing caps.

### 7.2 TradeSimulator — the 5 exit triggers (docs TRADING_RULES)
Entry fills at the **next day's open** (a signal fires on the close). Then each forward
day, in priority order (SL checked first = conservative):
```
risk    = entry − SL ;  T1 = entry + 2×risk ;  T2 = entry + 3×risk

1. stop-loss    : low ≤ SL              → exit remainder at SL
2. target1       : high ≥ T1 & !taken    → sell 50% at T1, move SL to breakeven (entry)
3. target2       : high ≥ T2             → exit remainder at T2
4. time-stop     : held ≥ 7 cal days     → exit remainder at close
5. thesis-break  : 2 closes < EMA20  OR  MACD histogram flips negative → exit at close
   (end-of-data) : ran out of candles    → mark out at last close
```
Costs: **5 bps slippage** each side (worse fills) + **0.05% commission** each side
(≈0.10% round trip). Sentiment-based thesis break omitted (no historical sentiment).

### 7.3 Metrics & benchmark
Per-trade **net-% returns** (sizing-agnostic → measures signal edge): win rate, expectancy,
profit factor (Σ gross wins ÷ |Σ gross losses|), max drawdown (additive equity curve),
Sharpe/Sortino (trade-level, not annualized), exit-reason breakdown. Benchmark = **Nifty
Buy & Hold** over the same window.

### 7.4 Parameter sweep
`generateRawSignals` once, then a grid of (time-stop × target R-multiple) is re-simulated
and ranked by profit factor (`backtest:sweep`). Isolates the exit/target hypotheses.

### 7.5 THE KEY FINDING — the strategy has no edge (yet)

> **Read this as the historical baseline.** These 981 trades are the frozen reference set
> every attribution/ablation experiment decomposes, so the numbers are kept verbatim. Two
> things have since superseded it as the *current* measurement:
> - **B8.1 deep window** (5.5yr, real VIX, production config): **4,394 trades, win 43.1%,
>   exp −0.097%/trade, PF 0.94** vs Nifty +42.9%. Less bad, measured across cycles, still
>   no edge. All research re-baselines from here.
> - **B1 portfolio backtest** is now the decisive gate (§13) — per-trade PF is necessary,
>   portfolio CAGR vs Nifty is what Phase 5 reads.

Backtested over **~16 months / 981 trades** (2 years of history backfilled):
```
Win rate      41.3%
Expectancy    −0.22% / trade
Profit factor 0.86         (< 1 = loses money)
Nifty B&H     +10.01%      (strategy badly underperforms)
Exit reasons  539 time-stop · 242 stop-loss · 172 thesis-break · ONLY 21 target2
```
The **sweep is decisive**: all **16** (time-stop × target) combos lose (PF 0.81–0.88), and
extending the time stop makes it *worse*. **Conclusion: the problem is the entries, not the
exits.** If every exit variation loses, the signal generation (4 technical factors + gates)
is not selecting stocks that outperform — no exit tuning rescues entries that lack edge.

> This is the backtest doing its job: proving — on paper, at zero cost — that the current
> strategy fails the Phase 5 gate ("beat Nifty risk-adjusted") **before** any capital is
> risked. Most people learn this after losing money; here it's a green test result.

**Caveats** stamped on every report: technicals-only (no sentiment/fundamental factors, no
historical sentiment); survivorship bias (universe = today's constituents); signal-edge (no
2-position cap); the additive max-drawdown is a naive artifact (overlapping trades summed),
not a real portfolio drawdown.

---

## 8. Database schema

Research / decision tables (Phase 1–3):

| Table | Role |
|---|---|
| `instrument` | Universe: token, symbol, name, sector, lot/tick, `lastPrice`, `volume` |
| `ohlcv` | Daily candles `(instrumentId, tradeDate)`, append-only |
| `signal_run` | One nightly run — regime, counts, engine/weights versions |
| `signal` | Approved signals — levels, sizing, scores, snapshot, all version stamps |
| `signal_rejection` | Every rejected candidate — stage + reason + detail |
| `undelivered_alert` | Failed Telegram alerts awaiting resend |
| `app_config` | KV config (e.g. instrument universe filter) |

Research-data tables added by Part B:

| Table | Role |
|---|---|
| `news_article` | The archive — source, url, title, symbols[], `publishedAt`, `fetchedAt`, **`availableAt`** (the as-of key), **`origin`** (`LIVE_RSS`/`LIVE_BSE`/`GDELT`/`BSE_BACKFILL`), FinBERT score + `model@revision` |
| `ingest_run` | Per-pass ingest observability (per-source counts, status, alert lines) |
| `quarterly_fundamental` | Point-in-time quarterly EPS/profit/sales + `announcedAt` → `availableAt` |
| `fundamental_snapshot` | Weekly as-of ratio capture (`fetchedAt` as-of key, append-only) |

> **The as-of rule for both:** research reads `availableAt` (news) and
> `announcedAt`-derived availability (fundamentals) — never `publishedAt` or period-end.
> Backfilled rows carry a *reconstructed* `availableAt`, which is why `origin` exists and
> why B7 evaluates per-origin.

Legacy OMS tables also exist (`order`, `position`, `trade_setup`, `broker_token`,
`broker_log`, …) from the options order-management layer; the research pipeline above is
independent of them.

---

## 9. Configuration reference

**Factor params** (per-factor config objects, defaults):
| Factor | Params |
|---|---|
| Trend | EMA 20 / 50 / 200, 25 pts each |
| Momentum | RSI 14, MACD 12/26/9, weights macd 0.5 / rsi 0.5 |
| RelativeStrength | lookback 60, excessCapPct 20 |
| SectorRelativeStrength | lookback 60, minPeers 3 — weight **0.25 in production**, 0 in the frozen baseline (§6.2a) |
| Volume | lookback 20, priceWindow 5, convictionCap 1.0 |
| Volatility | ATR 14, idealAtrPct 1.5, rejectAtrPct 6.0, percentileLookback 100 |
| Fundamental (B5) | PE-vs-sector percentile 0.6 + TTM EPS YoY growth 0.4, growthCapPct 40, ≥3 valid-PE peers — *observational* |
| Sentiment (B7) | windowDays 30, halfLifeDays 7, minArticles 3 — *observational* |

**Regime:** trend EMA 200, fast EMA 50, bull breadth 55%, bear breadth 40%,
crash drop 3%, crash VIX 30, high-vol VIX 20, high-vol ATR% 2.0.
VIX precedence (B8.4): explicit operator value → **stored India VIX** (token 99926017,
staleness-guarded 5d) → Nifty-ATR% proxy as the fallback.

**Strategy:** baseThreshold 65, technicalFloor 60, sentimentFloor 40, RSI band 35–68,
regime weight matrix (§6.2), threshold adj HIGH_VOL +5 / BEAR +10.
Research levers (absent in both shipped configs): `fundamentalFloor` / `sentimentFactorFloor`
(validated at 50 — the B9 stack, [`B9_RERUN.md`](./B9_RERUN.md)), `regimeGateOverrides`,
`disabledGates`.

**Signal math:** SL band 0.5%–10%, ATR mult 2.0 (<1.5%) / 1.5 (≥1.5%), swing lookback 15
× 0.997, target R-multiples 2 / 3, resistance lookback 60, minResistanceRr 1.5,
atrRejectPct 6.

**Portfolio (env):** `PORTFOLIO_BASE_CAPITAL` (₹100,000), `PORTFOLIO_MAX_OPEN_POSITIONS`
(2), `PORTFOLIO_MAX_PER_SECTOR` (1); dailyKillSwitch ₹5,000, minReturnVsCost 3×,
roundTripCostPct 0.25%, size-reduction 3–6% ATR × 0.75.

**Secrets (env):** `ANGELONE_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`,
`REDIS_*`, `RABBITMQ_URL`, `JWT_SECRET`, `ENGINE_VERSION`.

---

## 10. Scripts & scheduled jobs

**Scripts** (`bun run <name>`):
| Script | Does |
|---|---|
| `sync:instruments` | Refresh instrument master + universe |
| `backfill:ohlcv [scope] [days]` | Backfill history (`all` / `equities` / `indices` / NAME). For backtesting use `all 800` (~2yr) |
| `ohlcv:update` | Incremental candle update (also the nightly cron) |
| `factors:eval [scope]` | Universe-wide factor scan (ranked table) |
| `regime:detect [vix]` | Current market regime |
| `strategy:eval [vix] [slMax]` | Full pipeline preview (regime → portfolio) |
| `signal:inspect NAME` | Drill into one stock's signal math |
| `signals:run [vix]` | **Nightly run** — pipeline → persist → deliver |
| `backtest:run` | Historical replay + performance report vs Nifty B&H |
| `backtest:sweep` | Parameter sensitivity sweep (time-stop × targets), ranked by profit factor |
| `backtest:attribution [tier]` | Factor/gate attribution — conditioning + leave-one-out, incl. sentiment 2f/2g per origin tier ([`ATTRIBUTION.md`](./ATTRIBUTION.md)) |
| `backtest:regime` | Regime-conditioned entry experiment ([`REGIME_ENTRIES.md`](./REGIME_ENTRIES.md)) |
| `backtest:pullback` | BULL pullback-entry experiment + out-of-sample split ([`REGIME_ENTRIES.md`](./REGIME_ENTRIES.md) Step-4b) |
| `backtest:phase6 [tier] [--from D] [--folds N]` | Embargoed walk-forward; `--from` anchors coverage-era folds ([`B9_RERUN.md`](./B9_RERUN.md)) |
| `backtest:portfolio [tier]` | **Portfolio-level backtest — the fair "beat Nifty" gate**, incl. the B9 stack + COVERAGE window ([`B9_RERUN.md`](./B9_RERUN.md)) |
| `backtest:slots [tier]` | Slot-allocation rank keys + slots dose vs a seeded random control ([`SLOT_ALLOCATION.md`](./SLOT_ALLOCATION.md)) |
| `events:study [horizon]` | Event typing + forward-excess study by event type ([`EVENT_STUDY.md`](./EVENT_STUDY.md)) |
| `news:ingest` | Manual news-archive ingest + report (also the 15-min cron) ([`NEWS_SCRAPER.md`](./NEWS_SCRAPER.md)) |
| `news:gal:download` / `news:gal:import` | GDELT bulk media backfill — download on a workstation, import on the DB host ([`GDELT_BACKFILL.md`](./GDELT_BACKFILL.md)) |
| `news:backfill` / `news:backfill:universe` | GDELT DOC API backfill (throttled; targeted top-ups only) |
| `news:backfill:bse` | BSE announcements historical backfill ([`BSE_BACKFILL.md`](./BSE_BACKFILL.md)) |
| `news:remap` | Domain-aware re-tag of stored articles after alias growth |
| `sentiment:score` | FinBERT scoring catch-up (`--rescore` on model bumps) |
| `fundamentals:backfill` / `:snapshot` / `:retry` | Point-in-time fundamentals history + weekly snapshotter (B4) |
| `golden:snapshot` / `golden:update` | Refresh / re-baseline the golden fixture |
| `test`, `typecheck` | **416 tests**; strict tsc |

**Cron schedule** (RabbitMQ-backed, IST):
| Time | Job |
|---|---|
| 08:00 | Instrument master sync |
| 16:00 | Post-market cleanup (legacy OMS) |
| 16:30 | OHLCV incremental update |
| **17:00** | **Nightly signal run → persist → Telegram** |
| every 15 min | News ingest (4 sources) + FinBERT scoring pass — the archive clock |
| every 7 days | Fundamentals snapshot (fires on server boot) |

---

## 11. CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`): on push/PR → `bun install` →
  `prisma generate` → `typecheck` → `bun test` (unit + golden, no DB needed via dummy
  env). On push to `main` → build Docker image → publish to **ghcr.io**.
- Frontend has its own lint + build workflow.

---

## 12. End-to-end worked example

A real run (SIDEWAYS regime, threshold 65, ₹100k base capital, max 2 positions):

```
167 equities scanned
 └─ 114 rejected: composite < 65
 └─  28 rejected: MACD not bullish
 └─   6 rejected: RSI outside 35–68
 └─  14 rejected: R:R to resistance < 1.5 (signal math)
 └─   3 rejected: position-limit (qualified but slots full)
 └─   2 APPROVED

BHEL   composite 91.28  entry ₹435.40  SL ₹411.72 (5.44%)  T1 ₹482.76  T2 ₹506.44
       qty 156  value ₹67,922  (size-reduced: ATR in 3–6% band)
BAJAJ-AUTO composite 82.24  entry ₹10,331.50  SL ₹9,998.16 (3.23%)  T1 ₹10,998.18
       qty 7  value ₹72,320
```
BHEL got more capital (composite 91 → ~₹91k allocation → 156 sh); BAJAJ-AUTO's high price
(₹10k/sh) yields only 7 shares. Both stamped with `engine <sha>`, `w-<hash>`, `f-<hash>`
and persisted; the alert renders to Telegram.

---

## 13. Roadmap status & where to go next

| Phase | Status |
|---|---|
| **1 — Data foundation** (OHLCV, universe, DataQuality, nightly update) | ✅ Done |
| **2 — Factor layer** (Trend, Momentum, RS, Volume, Volatility) | ✅ Done |
| **2.5 — Golden determinism gate** | ✅ Done |
| **CI/CD** | ✅ Done |
| **3 — Decision layer** (Regime, Strategy, Signal math, Portfolio, Persistence, Delivery) | ✅ Done |
| **4 — Backtesting** (as-of replay, cost sim, vs Nifty B&H, sweep) | ✅ Done |
| **Part B — research program** (portfolio backtest, news archive + backfills, fundamentals, FinBERT, Fundamental + Sentiment factors, robustness) | ✅ B1–B8 done |
| **B9 — Phase 6 rerun** (joint selection over the enriched factor set) | ✅ **Done (2026-07-20)** — one best strategy; gate still failed ([`B9_RERUN.md`](./B9_RERUN.md)) |
| 5 / B10 — Paper trading (≥2-week beat-Nifty gate) | 🔒 **Hard-gated — gate re-read after B9: still failed, gap narrowed** |

> The live tracker is [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md); all math and the
> full limitations list are in [`COMPLETE_REFERENCE.md`](./COMPLETE_REFERENCE.md). This
> section is the summary, not the source of truth for task state.

### Why Phase 5 is still NOT next
Its gate is "beat Nifty risk-adjusted, net of costs, **out-of-sample**." The B9 portfolio
gate — the fair test in the same units as the benchmark, read on the era the winning
config was walk-forward-validated on — **still fails**: the B9 stack loses −6.5% (risk
sizing, maxDD −11.1) vs Nifty +0.8% on the 2024-07→2026-07 coverage window
([`B9_RERUN.md`](./B9_RERUN.md)). That is the closest approach yet (B1 read −12.7% vs
−4.4%), with the first *positive* absolute portfolio returns on the FULL/OOS windows —
but a negative return cannot clear a beat-the-benchmark gate.

### Where the evidence now points (post-B9)
The Part-B program answered §7.5's "the problem is the entries" and kept measuring until
one strategy survived joint selection:

- **One best evaluated strategy exists:** `pullback + srs0.25 + ff50 + sf50 − volume` —
  selected on **all 4 coverage-era walk-forward folds × both origin tiers** (the first
  uniform selection in the project). Signal-edge OOS −0.04/PF 0.97 vs baseline −0.47/0.73.
- **Both orthogonal factors earned a lever, the same way:** bucket blends rejected
  (monotone-harmful), floor gates validated (concave, peak 50) — fundamental
  ([`FUNDAMENTAL_FACTOR.md`](./FUNDAMENTAL_FACTOR.md)) and sentiment
  ([`SENTIMENT_FACTOR.md`](./SENTIMENT_FACTOR.md) §4a; +0.11 exp on the strong-evidence
  tier, the largest single-lever delta measured). Information lives in the negative tails,
  not the rankings — every Spearman is still ≈0.
- **Volume is out** — `-novol` in every anchored winner (8/8); Step-1's suspicion
  confirmed under joint selection.
- **The largest unworked lever is slot allocation:** the 2-slot book takes ~14% of
  signals, picked by a ρ≈0 composite ranking. Risk sizing is the standing
  capital-preservation default (best drawdowns everywhere measured).
- ⚙️ **Operator decision taken (2026-07-20):** the B9 stack is now the production config
  (`w-68f83d8edbf9`) — it dominated the prior production config on every window/sizing/cost
  level measured.

### The honest bottom line
A complete, reproducible signal factory; an honest measurement stack (attribution,
selection tests, embargoed + anchored walk-forward, portfolio simulator); a real data
moat accruing; and now **one jointly-selected best strategy with positive absolute
portfolio returns — that still trails the benchmark on its validated era.** The program's
repeated pattern — single-window result looks like a breakthrough, the honest test
tempers it, the doc records the correction — is the process working, not failing.

**Known simplifications** (documented, non-blocking): `instrumentMasterVersion` is
best-effort; `snapshotJson` holds the approved signal (could carry the full factor bundle);
Fundamental + Sentiment buckets are empty by choice (not absent). **Open integrity
residual:** historical index-constituent changes could not be sourced, so survivorship bias
in the pre-curation past is unrepaired — revisit before B9's conclusions are treated as
final. The architecture review's governing criticism also stands: the data layer has no
immutable raw capture and entity resolution is unversioned, so the *archive* is not yet held
to the same reproducibility standard as the *factor pipeline*
([`ARCHITECTURE_REVIEW_B3_B4.md`](./ARCHITECTURE_REVIEW_B3_B4.md)).

---

*§§1–12 were written at the completion of Phase 4 and remain the exact implementation in
`src/`; §13 and the config/script tables are maintained forward. Covered by the
**416-test** suite + the golden determinism gate.*
