# QuantSwing — Complete Reference (zero → current)

> **One file, everything:** what the system is, every formula actually implemented in `src/`
> (indicators, the factor layer, regime, strategy, signal math, portfolio, backtest, research
> harnesses), every measured finding (Steps 1–6), and every known limitation.
> Verified against source at 149-test / typecheck-clean state. Companions:
> [`SYSTEM.md`](./SYSTEM.md) (as-built narrative), [`ATTRIBUTION.md`](./ATTRIBUTION.md),
> [`REGIME_ENTRIES.md`](./REGIME_ENTRIES.md), [`PHASE6.md`](./PHASE6.md),
> [`HANDOFF_NEXT_STEPS.md`](./HANDOFF_NEXT_STEPS.md) (plan + status).

---

## Table of contents

1. [What the system is](#1-what-the-system-is)
2. [The pipeline](#2-the-pipeline)
3. [Data foundation & data-quality math](#3-data-foundation--data-quality-math)
4. [Indicator math (in-house)](#4-indicator-math-in-house)
5. [The factor layer — contracts + factors](#5-the-factor-layer) *(Fundamental/Sentiment math: their own docs)*
6. [Golden determinism gate](#6-golden-determinism-gate)
7. [Market regime math](#7-market-regime-math)
8. [Strategy math (WeightedStrategy)](#8-strategy-math-weightedstrategy)
9. [Experimental: BullPullbackStrategy (v1 + v2)](#9-experimental-bullpullbackstrategy)
10. [Signal math (entry / stop / targets / R:R)](#10-signal-math)
11. [Portfolio math (sizing / caps / kill switch)](#11-portfolio-math)
12. [Persistence & version stamps](#12-persistence--version-stamps)
13. [Backtest math (replay / simulator / metrics)](#13-backtest-math)
14. [Research-harness math (attribution / walk-forward)](#14-research-harness-math)
15. [Findings timeline — every measured result](#15-findings-timeline)
16. [Limitations — the complete honest list](#16-limitations)
17. [Current state & what's next](#17-current-state--whats-next)

---

## 1. What the system is

A **deterministic, explainable quant decision-support system** for Indian equities (NSE).
It scans ~166 stocks nightly and produces ranked, gated, risk-sized **buy signals** delivered
to Telegram; **orders are placed manually** — decision support, not an execution bot.

**Design creed:** every number is reproducible from stored candles + versioned config.
No randomness, no wall-clock reads inside factor logic, every rejection has a persisted reason.

**Stack:** Bun + TypeScript (strict) + Express + Prisma/PostgreSQL + Redis (cache/LTP) +
RabbitMQ (jobs). All indicator math is in-house so it can be golden-tested byte-for-byte.

**Status:** Phases 1–4 complete + the Part-B research program (attribution, regime
experiments, walk-forward, portfolio backtest, news archive + backfills, fundamentals,
FinBERT, Fundamental + Sentiment factors) — **B1–B9 done** ([`B9_RERUN.md`](./B9_RERUN.md)).
**364 tests, typecheck clean.** The strategy has been improved from clearly losing to near-breakeven **but has no
positive out-of-sample edge yet** — Phase 5 (paper trading) is gated (§15, §17).

## 2. The pipeline

```
Angel One (scrip master + daily candles + live LTP)
        │
        ▼
 Instrument master ──► Universe (166 equities in 23 sectors + 3 indices)
        │
        ▼
 OHLCV store (daily candles, append-only upsert)  ◄── nightly incremental (16:30 IST)
        │
        ▼
 DataQualityService  ──► StockContext (candles ≤ asOf — no lookahead, + Nifty benchmark
        │                              + sector-peer returns via cross-sectional pre-pass)
        ▼
 8 Factors ──► FeatureBundle (immutable, deep-frozen)
        │        [4 directional in the composite · volatility → signal math ·
        │         sectorRS weighted 0.25 in PRODUCTION · fundamental + sentiment observational]
        ▼
 MarketRegimeService (Nifty trend + EMA50 breadth + VIX/ATR proxy)
        │
        ▼
 WeightedStrategy (regime-weighted composite + hard gates) ──► TradeCandidate | Rejection
        │
        ▼
 Signal math (ATR/swing stop, 2R/3R targets, R:R vs resistance) ──► levels | Rejection
        │
        ▼
 PortfolioManager (conviction sizing, caps, kill switch) ──► ApprovedSignal | Rejection
        │
        ▼
 Persistence (SignalRun + Signal + SignalRejection, version-stamped, append-only)
        │
        ▼
 Delivery (AlertFormatter → Telegram, 3× backoff → undelivered queue)
```

Every stage is a **pure function of injected inputs** plus a thin I/O builder. Same inputs →
byte-identical outputs. Cron (IST): 08:00 instrument sync · 16:30 OHLCV update · **17:00
nightly signal run**.

## 3. Data foundation & data-quality math

- **Universe:** 166 NSE equities (committed reference data, each with a sector) + NIFTY,
  BANKNIFTY, SENSEX index rows. Corporate-action aliases handled explicitly; unresolved
  symbols are reported, never silently dropped. Tick sizes paise → ₹ (`tick_size / 100`).
- **OHLCV:** daily candles keyed `(instrumentId, tradeDate)`, append-only via upsert.
  Backfill ~800 calendar days for backtesting (needs ≥ EMA200's 200 bars + RS's 61).

**DataQualityService** — factors never see bad data. Per candle series as of `asOf`:

```
malformed(c)  = any(o,h,l,c ≤ 0) OR volume < 0 OR high < low
                OR high < max(open,close) OR low > min(open,close)

continuity    = min(1, present_candles / (weekdays_in_span × 0.94))
                                        // 0.94 ≈ 1 − holiday ratio
stalenessDays = asOf − last_candle_date  (calendar days)

score = continuity × (1 − malformedRatio)
        × (stalenessDays > 5 ? 0.5 : 1)     // stale penalty
        × (candles < 200    ? 0.5 : 1)      // too-short penalty
```

**score < 0.8 → the instrument is skipped for the run.** Index rows have volume 0
(legitimate — spot indices don't trade) and are not treated as malformed.

## 4. Indicator math (in-house)

All in `src/factors/indicators.ts`, versioned and golden-tested.

**EMA (SMA-seeded), period p:**
```
EMA[p−1] = SMA(values[0..p−1])
k        = 2 / (p + 1)
EMA[i]   = (value[i] − EMA[i−1]) × k + EMA[i−1]     for i ≥ p
```

**RSI (Wilder smoothing), period p = 14:**
```
seed:  avgGain = mean(gains over first p changes)
       avgLoss = mean(losses over first p changes)
step:  avgGain = (avgGain × (p−1) + gain_i) / p
       avgLoss = (avgLoss × (p−1) + loss_i) / p
RS  = avgGain / avgLoss
RSI = 100 − 100 / (1 + RS)          (avgLoss = 0 ⇒ RSI = 100)
```

**MACD (12 / 26 / 9):**
```
macdLine  = EMA(close, 12) − EMA(close, 26)
signal    = EMA(macdLine, 9)
histogram = macdLine − signal
```

**ATR (Wilder), period p = 14:**
```
TR[i]  = max(high[i]−low[i], |high[i]−close[i−1]|, |low[i]−close[i−1]|)
ATR[p] = mean(TR[1..p])
ATR[i] = (ATR[i−1] × (p−1) + TR[i]) / p
```

**Lookback return (shared by both RS factors and the sector pre-pass):**
```
lookbackReturnPct(closes, L) = (close_now − close_Lago) / close_Lago × 100
                               (null if series < L+1 or base ≤ 0)
```

**Rounding:** `round(n, dp=2) = Number(n.toFixed(dp))` — applied to all published metrics
so outputs are stable and tidy.

## 5. The factor layer

### 5.1 Contracts (frozen)

```typescript
interface Factor {
  name: string;
  category: FactorCategory;      // TREND | MOMENTUM | RELATIVE_STRENGTH | VOLUME | VOLATILITY | …
  evaluate(ctx: StockContext): FactorOutput;   // PURE — no clock / random / env
}

type FactorOutput = {
  score: number;                  // 0–100, higher = more bullish
  agreementContribution: number;  // directional lean in [−1, +1]
  explanations: string[];         // human-readable reasons
  metrics: Record<string, MetricValue>;  // raw values for logging/attribution
};

type StockContext = {
  symbol: string;
  asOf: string;                   // ISO date — injected, never wall clock
  candles: Candle[];              // ascending, ≤ asOf (no lookahead)
  dataQualityScore: number;
  sector: string | null;
  benchmark: { symbol: 'NIFTY'; candles: Candle[] } | null;
  sectorPeers: { peerReturnsPct: number[]; lookback: number } | null;  // cross-sectional pre-pass
};
```

The runner (`buildFeatureBundle`) times each factor **outside** `evaluate` (attaching
`executionTimeMs`), then **deep-freezes** the bundle — so factor output stays byte-identical
across runs. Unless noted, `agreementContribution = (score − 50) / 50`.

### 5.2 TrendFactor — EMA 20/50/200 stack

25 points per satisfied condition (config weights, sum 100):
```
+25 if price > EMA20
+25 if EMA20 > EMA50
+25 if EMA50 > EMA200
+25 if price > EMA200
```
100 = perfect bullish stack; 0 = perfect bearish stack. Insufficient history for EMA200 →
score 0, explained. Metrics: `close, emaFast, emaMid, emaSlow` (these feed strategy gates).

### 5.3 MomentumFactor — MACD + RSI (50/50 blend)

```
macdScore = (macd > 0 ? 50 : 0) + (histogram > 0 ? 50 : 0)    // 0 / 50 / 100
rsiScore  = clamp(RSI, 0, 100)                                 // RSI used directly
score     = 0.5 × macdScore + 0.5 × rsiScore
```
Overbought exclusion is deliberately the *strategy's* job (its RSI gate) — a momentum factor
reports strong momentum, it doesn't mean-revert it.

**Metrics** include `rsi, macd, signal, histogram` **and the previous-bar readings**
`rsiPrev, histogramPrev` (added for pullback-resumption detection — computed on
`closes[0..n−1]`; if the series is one bar too short they fall back to the current value, so
"rising" reads false → fails safe).

### 5.4 RelativeStrengthFactor — vs Nifty (lookback 60)

```
stockRet = lookbackReturnPct(stock closes, 60)
benchRet = lookbackReturnPct(NIFTY closes, 60)
excess   = stockRet − benchRet
norm     = clamp(excess / 20, −1, +1)        // excessCapPct = 20
score    = 50 + norm × 50
```
Outperform Nifty by ≥ 20% over 60d → 100; underperform by ≥ 20% → 0. Missing benchmark or
short history → score 0 with the reason in explanations.

### 5.5 SectorRelativeStrengthFactor — rank within sector (lookback 60) — *observational, weight 0*

The cross-sectional half of relative strength: not "is it beating the market" but "does it
lead the stocks it trades alongside."

```
selfRet    = lookbackReturnPct(own closes, 60)
peerRets   = 60d returns of every equity in this stock's sector   // injected pre-pass
below      = #peers with ret <  selfRet
equal      = #peers with ret == selfRet                            // includes self
percentile = (below + 0.5 × equal) / peerCount                     // tie-safe mid-rank
score      = percentile × 100
agreementContribution = (score − 50) / 50
```
Neutral 50 (no lean) when: no peer data, < 3 peers (`minPeers`), or own history too short.
Metrics: `stockReturnPct, sectorMedianReturnPct, percentile, rankFromTop, peerCount`.

**The pre-pass** (purity-preserving): a single stock can't see its peers, so the runner
computes every universe stock's 60d return, groups by sector, and injects the group via
`ctx.sectorPeers` — in the backtest daily loop, in `loadSectorPeerReturns` (live/eval), and
across the golden fixture stocks. `evaluate` never fetches anything.

**Status:** **[UPDATED — B2, 2026-07-18]** weight 0 in the frozen research baseline
(`DEFAULT_STRATEGY_CONFIG`), but **0.25 in the production config** — it graduated after
`backtest:phase6` selected `pullback+srs0.25` on all three walk-forward folds. The baseline
stays frozen so every experiment keeps its control. Measured value: §15, Step 3.

### 5.6 VolumeFactor — volume-confirmed direction

```
baseVol    = SMA(volume, 20)
recentVol  = SMA(volume, 5)
relVol     = recentVol / baseVol
recentRet  = (close − close_5ago) / close_5ago
dir        = sign(recentRet)                       // −1 / 0 / +1
conviction = clamp((relVol − 1) / 1.0, 0, 1)       // 2× avg volume = full conviction
score      = 50 + dir × conviction × 50
```
Volume **amplifies** the price direction, never flips it: up-move on heavy volume → toward
100 (accumulation); down-move on heavy volume → toward 0 (distribution); thin/average volume
→ 50 (unconfirmed). Index rows (volume 0) take the insufficient branch.

### 5.7 VolatilityFactor — ATR% favorability (non-directional)

```
atrPct = ATR14 / close × 100
score  = 100                                        if atrPct ≤ 1.5   (idealAtrPct)
       = 0                                          if atrPct ≥ 6.0   (rejectAtrPct)
       = 100 × (6.0 − atrPct) / (6.0 − 1.5)         otherwise (linear)
```
`agreementContribution = 0` always — volatility is not bull or bear. Also exposes an
informational ATR percentile over the last 100 bars (same tie-safe mid-rank formula as §5.5).
Its `atr`/`atrPct` feed the downstream stop/size rules; it is **not** in the directional
composite.

## 6. Golden determinism gate

A committed fixture of real candles (15 stocks + Nifty, ~210 candles each, fixed `asOf`) and
the exact factor output it must produce. The test asserts **byte-identical** output (score,
agreement, explanations, metrics — everything except `executionTimeMs`). Any factor change
that shifts a number fails CI until consciously re-baselined (`bun run golden:update`) with
justification. Re-baselined twice in this program, both additive: the new SectorRS factor,
and the `rsiPrev`/`histogramPrev` momentum metrics.

## 7. Market regime math

As of `asOf`, from Nifty trend, universe breadth, and VIX (Nifty-ATR% proxy when no VIX):

```
return1d = (nifty_close − nifty_prevClose) / nifty_prevClose × 100
breadth  = 100 × (#universe stocks with close > their EMA50) / (#with enough history)

priority:
1. CRASH     if return1d ≤ −3  OR  vix ≥ 30          → no new signals
2. HIGH_VOL  if vix ≥ 20  OR  (no vix AND niftyAtrPct ≥ 2)
3. BULL      if nifty_close > EMA200(nifty)  AND breadth ≥ 55
   BEAR      if nifty_close < EMA200(nifty)  AND breadth ≤ 40
   SIDEWAYS  otherwise
```

Regime affects the strategy two ways: bucket weights (§8) and a threshold add-on
(HIGH_VOL +5, BEAR +10). There are **no** per-regime size multipliers (spec drift — never built).

## 8. Strategy math (WeightedStrategy)

### 8.1 Bucket scores

```
technical  = Σ(score_f × w_f) / Σ(w_f)  over PRESENT directional factors
             weights: trend 0.35, momentum 0.30, relativeStrength 0.25, volume 0.10
             (renormalized over whichever are present; volatility excluded — it is
              non-directional. sectorRS: excluded in the frozen baseline, weight 0.25
              in the production config)
sentiment  = mean of sentiment-bucket factor scores   → null (bucket held EMPTY)
fundamental= mean of fundamental-bucket factor scores → null (bucket held EMPTY)
```

### 8.2 Composite — regime-weighted, renormalized over present buckets

```
regime weights (technical / sentiment / fundamental):
  BULL      0.50 / 0.30 / 0.20
  SIDEWAYS  0.35 / 0.25 / 0.40
  HIGH_VOL  0.40 / 0.45 / 0.15
  BEAR      0.30 / 0.30 / 0.40

composite = Σ(bucketScore × weight) / Σ(weight)   over present buckets
```
Only `technical` is *present* ⇒ **composite = technicalScore** (the other buckets
renormalize out). **[UPDATED — B5/B7]** The Sentiment and Fundamental factors now exist,
but their buckets are held **explicitly empty** so the blend stays dormant and the baseline
stays byte-identical — a *listed* factor would auto-activate the regime blend. Activation
is a one-line config lever, set only on walk-forward evidence (B9).

### 8.3 Agreement (uncalibrated)

```
agreement = clamp(1 − stddev(directional factor scores) / 50, 0, 1)
```
Named `agreementScore`, deliberately not "confidence" — uncalibrated heuristic.

### 8.4 Threshold and gates

```
threshold = 65 + adj      (adj: BULL 0, SIDEWAYS 0, HIGH_VOL +5, BEAR +10)

Gates (ALL must pass; first failure = the persisted rejection reason):
1. regime            : regime ≠ CRASH (and not skipped by a regime override)
2. composite         : composite ≥ threshold
3. technical-floor   : technicalScore ≥ 60
4. macd-bullish      : momentum.histogram > 0
5. price-above-ema20 : close > EMA20
6. rsi-band          : rsiMin ≤ RSI ≤ rsiMax          (default 35–68)
   [sector-leadership: sectorRS ≥ floor — only when a regime override sets minSectorRs]
   [sentiment-floor   : sentiment ≥ 40 — only when a SentimentFactor exists]
```
Gate "R:R ≥ x" from the spec is realized downstream by signal math (§10, `rr-resistance`).

### 8.5 Research knobs (default-off; production behaviour & weights-hash unchanged)

- `disabledGates: string[]` — a disabled gate still reports pass/fail but can't reject
  (built for leave-one-out ablation, §14).
- `regimeGateOverrides: { [regime]: { rsiMin?, rsiMax?, minSectorRs?, skip? } }` — per-regime
  tightening (built for the regime-conditioned entry experiments).
- `fundamentalFloor?: number` (B5) / `sentimentFactorFloor?: number` (B7) — add a
  `fundamental-floor` / `sentiment-factor-floor` gate that rejects a factor score below
  the floor, reading the result straight off the bundle while the bucket stays inactive.
  A missing factor result rejects (unavailable ≠ pass); the thin-coverage neutral-50
  passes any floor ≤ 50. Both at 50, with volume pruned, form the B9-selected stack
  ([`B9_RERUN.md`](./B9_RERUN.md)) — validated, unadopted.

## 9. Experimental: BullPullbackStrategy

**[UPDATED — B2]** ~~Not wired to production.~~ **In production since B2** — the v2
variant (histogram-rising resumption) wraps the SRS-weighted composite in
`createProductionStrategy()`. Delegates byte-for-byte to the base strategy in every regime
except BULL; in BULL it replaces the buy-strength decision with a **pullback** entry:

```
v1 gates (all must pass, BULL only):
  uptrend-stack          : EMA20 > EMA50 > EMA200        (trend intact under the dip)
  above-ema50            : close > EMA50                 (trend not broken)
  pullback-not-extended  : (close − EMA20)/EMA20 × 100 ≤ maxExtensionAbovePct   (≈ a dip)
  pullback-rsi           : rsiMin ≤ RSI ≤ rsiMax         (cooled, not crashed; e.g. 35–50)

v2 adds resumption confirmation (the dip must be ENDING, not still falling):
  rsi-rising             : RSI > RSI_prev                 (optional)
  histogram-rising       : histogram > histogram_prev     (optional)
```
Rejections are namespaced `bull-pullback:<gate>`. Composite/agreement fields pass through
from the base evaluation (only the decision changes). Measured results: §15 Step 4b.

## 10. Signal math

For a strategy-passed candidate (`entry` = last close):

```
entryLow  = entry × 0.995
entryHigh = entry × 1.005                    // ±0.5% entry band

atrPct = ATR14 / entry × 100
  REJECT "atr-too-high"   if atrPct ≥ 6

mult     = atrPct < 1.5 ? 2.0 : 1.5          // wider stop for calmer stocks
SL_ATR   = entry − mult × ATR14
SL_SWING = min(low over last 15) × 0.997
SL       = max(SL_ATR, SL_SWING)             // the TIGHTER of the two
slPct    = (entry − SL) / entry × 100
  REJECT "sl-band"        if slPct < 0.5 OR slPct > 10     // 10% = operator override (spec said 3%)

risk    = entry − SL                          // risk per share
target1 = entry + 2 × risk                    // 2R
target2 = entry + 3 × risk                    // 3R

resistance = max(high over prior 60 candles, excluding today)
             (null if ≤ entry → breakout, clear overhead)
rrToResistance = (resistance − entry) / risk
  REJECT "rr-resistance"  if resistance ≠ null AND rrToResistance < 1.5

  REJECT "insufficient-history" if candles < max(ATR15, resistance60, swing15)
```

## 11. Portfolio math

Order: kill switch → per-candidate viability → rank-order allocation.

```
KILL SWITCH : dailyRealizedLoss ≥ ₹5,000  → reject ALL ("kill-switch")

SIZING (conviction-based — no fixed-risk model, no capital cap):
  allocatedCapital = baseCapitalPerTrade × (composite / 100)     // base ₹100,000 (env)
  qty              = floor(allocatedCapital / entry)
  size-reduction   : if 3 ≤ atrPct < 6 → qty = floor(qty × 0.75)
  REJECT "sizing"  if qty < 1

COST-DRAG:
  expectedProfit = qty × (target1 − entry)
  cost           = positionValue × 0.25 / 100        // roundTripCostPct = 0.25%
  REJECT "cost-drag" if expectedProfit < 3 × cost    // minReturnVsCost = 3

ALLOCATION (candidates ranked by composite, descending):
  slots = maxOpenPositions − open                     // maxOpenPositions = 2 (env)
  REJECT "position-limit" if slots exhausted
  REJECT "sector-cap"     if sector already at maxPerSector (1)
  else APPROVE, decrement slots, mark sector
```

Runtime env knobs: `PORTFOLIO_BASE_CAPITAL`, `PORTFOLIO_MAX_OPEN_POSITIONS`,
`PORTFOLIO_MAX_PER_SECTOR`.

**Known tension (from attribution):** composite ρ ≈ 0 vs outcomes (§15 Step 1) — so
conviction sizing currently allocates more capital to trades that are *not* measurably
better. Flagged for the eventual weighting rework.

## 12. Persistence & version stamps

One append-only transaction per run: `SignalRun` (summary), `Signal` (each approval, full
levels + sizing + `snapshotJson`), `SignalRejection` (each drop, with stage
strategy|signal-math|portfolio + reason + detail).

```
snapshotSchemaVersion   = "1.0.0"
engineVersion           = git sha (env ENGINE_VERSION → git → "dev")
weightsVersion          = "w-" + sha256(regimeWeights + technicalFactorWeights
                                        + baseThreshold + regimeThresholdAdj)[0..12]
factorConfigChecksum    = "f-" + sha256(all 6 factor default configs)[0..12]
instrumentMasterVersion = "im-<universeCount>@<lastSyncDate>"
```
Change any factor param or weight ⇒ checksum changes ⇒ any historical signal names the exact
config that produced it. (Research knobs `disabledGates`/`regimeGateOverrides` are
intentionally outside the hash — absent in production.)

Delivery: Markdown alert (regime, per-signal entry band / SL% / targets / qty / composite /
agreement + manual-order disclaimer); 3× exponential backoff; final failure → Postgres
`undelivered_alert` queue, flushed next run. Delivery never fails the pipeline.

## 13. Backtest math

### 13.1 Replay (no lookahead)

All candles loaded once into memory. For each trading day D (after 205-bar warmup):
rebuild regime (breadth from that day's slices) → factors (with the sector pre-pass) →
strategy → signal math, using candles ≤ D only. Dedup: fixed **5-day re-signal cooldown**
per stock (config-independent → the signal set is stable across sweeps). Signal generation
is separated from exit simulation (`generateRawSignals` / `simulateSignals(Paired)`) so a
sweep replays once and re-simulates cheaply. Each `RawSignal` carries its full
`StrategyEvaluation` + `factorScores` for attribution.

**Measures signal edge:** every signal is taken; the live 2-position/sizing caps are NOT
enforced.

### 13.2 Trade simulator

Entry fills at the **next day's open** (signal fires on the close):
```
slip       = 5 bps = 0.0005
entryPrice = nextOpen × (1 + slip)          // worse fill
exit fills = price × (1 − slip)
costs      = 0.05% per side (≈ 0.10% round trip) applied to net return
```
Forward day-by-day, priority order (SL first = conservative):
```
1. stop-loss    : low ≤ SL              → exit remainder at SL
2. target1      : high ≥ T1 (once)      → sell 50%, move SL to breakeven (entry)
3. target2      : high ≥ T2             → exit remainder at T2
4. time-stop    : held ≥ 7 calendar days → exit remainder at close
5. thesis-break : 2 closes < EMA20  OR  MACD histogram flips negative → exit at close
   end-of-data  : series exhausted       → mark out at last close
```
Sentiment thesis-break omitted (no historical sentiment).

### 13.3 Metrics (per-trade net %, sizing-agnostic)

```
winRate       = wins / trades × 100
expectancy    = mean(netReturnPct)                       // the headline per-trade edge
profitFactor  = Σ(gross wins) / |Σ(gross losses)|        // < 1 = loses money
cumulative    = Σ netReturnPct                            // additive, equal-weight (naive)
maxDrawdown   = min over the additive equity curve of (equity − running peak)
sharpe        = mean / stddev(returns)                    // trade-level, NOT annualized
sortino       = mean / stddev(negative returns only)
+ avg win/loss, best/worst, avg holding days, exit-reason counts
```
Benchmark: **Nifty Buy & Hold** over the same window (naive comparison — see §16.9).

## 14. Research-harness math

### 14.1 Attribution (`backtest:attribution`) — [`ATTRIBUTION.md`](./ATTRIBUTION.md)

- **Spearman rank correlation** of each decision-context feature (factor scores, composite,
  agreement) vs realized net return: rank both series (ties get the mean rank), then Pearson
  on the ranks. Robust to the factors' clamped, non-linear scales.
- **Terciles:** sort signal→trade pairs by score, split into 3 equal buckets, compute full
  metrics per bucket. Edge = expectancy rising low→high.
- **Gate ablation (leave-one-out):** disable one gate via `disabledGates`, regenerate +
  re-simulate, compare vs baseline. A gate has positive edge iff disabling it LOWERS expectancy.
- **Factor ablation:** drop one factor from `technicalFactorWeights` (composite renormalizes),
  regenerate, compare.
- **Selection test (add-a-factor):** give a candidate factor composite weight, regenerate —
  does the *newly selected* trade set improve? (Crucially different from conditioning, which
  only re-ranks already-selected trades — range-restricted.)
- **Regime breakdown:** all metrics grouped by signal-time regime.

### 14.2 Walk-forward (`backtest:phase6`) — [`PHASE6.md`](./PHASE6.md)

```
makeExpandingFolds(warmup, total, nFolds):
  span     = total − warmup
  testSize = floor(span / (nFolds + 1))
  fold i   : train = [warmup, warmup + testSize×(i+1))       // expanding
             test  = [warmup + testSize×(i+1), next boundary) // contiguous, unseen
```
Per fold: score every candidate strategy on the **train** window, select the best by net
expectancy (finite, unlike PF which can be ∞), then measure the selection on the **test**
window. Concatenate all test trades → the honest out-of-sample result. Control: baseline
strategy held fixed over the same test windows.

**[B8.3]** `embargoDays`: train ends that many trading days before its test window, so a
train-end signal's exits can't resolve inside the test (selection leakage).

**[B9]** `makeAnchoredFolds(warmup, firstTestIndex, total, nFolds, embargo)`: the first
test window is anchored at a chosen date and [firstTestIndex, total) splits evenly into
nFolds; train still expands from warmup. Why: archive-dependent levers (ff/sf floors) are
inert before the archives begin (2024-01/2025-01), so deep-window folds under-test them —
anchoring the test era inside coverage is the fair design
(`backtest:phase6 [tier] --from 2024-07-01 --folds 4`).

## 15. Findings timeline

Backtest window: 167 stocks × 544 trading days ≈ 2 years, **981 baseline trades**.

**Phase 4 (pre-program):** baseline loses — win 41.3%, expectancy **−0.22%/trade**, PF
**0.86**; Nifty B&H +10% over the window; 539 time-stops / 242 stops / only 21 target2 →
trades enter and go nowhere. All 16 exit-sweep configs lose (PF 0.81–0.88) ⇒ **the problem
is the entries, not the exits.**

**Step 1 — Attribution:** *nothing* discriminates winners from losers — Spearman ≈ 0 for
every factor **and the composite** (ρ = −0.02). Gates mostly inert (only the RSI 35–68 band
truly filters: removing it → −0.39). Losses regime-concentrated: **BULL −0.67%/trade, PF
0.61 (n=397)**; SIDEWAYS ~breakeven (+0.02, n=534). Factor ranking: trend > RS > momentum ≈ 0
> volume (mildly harmful). ⇒ **The entry *style* (buying trend strength) is the problem.**

**Step 2 — Doc reconciliation:** every spec-drift row annotated (`[AS-BUILT]` banners across
~20 docs; ADR-0008 superseded on BullMQ→RabbitMQ and indicatorts→in-house).

**Step 3 — SectorRelativeStrength:** built (observational, weight 0 — baseline
byte-identical). Conditioning ρ ≈ 0 (range-restricted), **but the selection test**: adding it
at weight 0.25 → expectancy −0.22 → **−0.13**, PF 0.86 → **0.92**, dropping ~125
sector-laggard trades; concave in weight (peaks ~0.25) → real signal. First orthogonal
factor that measurably helps. Weight deferred to joint evaluation.

**Step 4 — Fundamental: data-blocked** (no point-in-time fundamental history exists;
current-PE scoring of old signals = lookahead — refused). **Redirected to regime-conditioned
entries:** skipping BULL entirely → **+0.06, PF 1.04** (≈breakeven) — but every tightening
filter (RSI ceiling, sector-leadership) made the *surviving* BULL trades **worse** (−0.70…
−0.92 vs −0.67). ⇒ Filters only avoid BULL; nothing in the signal set picks good BULL
entries of the buy-strength style.

**Step 4b — BULL pullback entry (v1):** different *style* — dip to ~EMA20, RSI 35–50, stack
intact. BULL expectancy **−0.67 → −0.21**, PF 0.61 → 0.77 at the **same trade count**
(391 vs 397) — a genuine entry fix, not avoidance; monotonic response to tightening.

**Step 4b-v2 — resumption confirmation:** + MACD-histogram-rising gate. Full-window it
looked like the breakthrough (overall **+0.06 / PF 1.05**, BULL +0.10 / PF 1.09) — **but the
train/test split showed that was in-sample optimism**: unseen-half result **−0.10 / PF 0.93**
(BULL −0.32). What survives OOS is the *relative* gain: v2 beats baseline on both halves and
turns BULL from −1.47 → −0.32 on unseen data. **Method lesson: grid-picked configs must be
OOS-validated before belief.**

**Phase 6 — combine + walk-forward:** candidates {SRS 0/0.25} × {strength/pullback-v2},
3 expanding folds, select-on-train/measure-on-test. `pullback+srs0.25` selected on **all 3
folds** (stable). Out-of-sample concatenated: **combined −0.12 / PF 0.91 vs baseline −0.34 /
PF 0.78** — robustly better (≈⅓ of the loss removed), **but still negative**. ML weighting
deliberately deferred (ρ≈0 features + overfit risk). **Phase 5 stays gated.**

**B5 — FundamentalFactor (2026-07-18):** bucket blend **rejected** (monotone-harmful with
dose); **floor gate validated** (concave, peak 50: +0.07 exp) — the information is in the
low-fundamental tail. Held observational. → `FUNDAMENTAL_FACTOR.md`

**B7 — SentimentFactor Phase 2 (2026-07-20, deep window, per-origin):** same shape,
stronger dose — blend rejected; **floor 50 = +0.11 exp on the strong-evidence tier
(live+bse), first full-window breakeven crossing (+0.01/PF 1.01)**; effect *stronger* on
exchange-timestamped evidence than with GDELT added (anti-artifact ordering); `live` tier
= clean null control (0% coverage, floors provably inert). → `SENTIMENT_FACTOR.md` §4a

**B9 — joint rerun (2026-07-20):** anchored coverage-era folds (2024-07→, 4 folds) →
**`pullback+srs0.25+ff50+sf50-novol` selected on all 4 folds × both tiers** (first uniform
selection; volume pruned everywhere it could be). Signal-edge OOS −0.04/PF 0.97 vs baseline
−0.47/0.73. Portfolio gate: first **positive absolute returns** (FULL +22.8%, OOS +24.8%,
maxDD −11%) but **still trails Nifty on the validated coverage era (−6.5% vs +0.8%) — B10
stays gated.** New largest lever: slot allocation. → `B9_RERUN.md`

**Net effect of the program:** baseline (deep window) PF 0.94 signal-edge / deeply negative
portfolio → one jointly-selected strategy at signal-edge PF 0.97 OOS and the first positive
absolute portfolio returns. Real, durable, honestly-measured improvement; **no
benchmark-beating edge yet.**

## 16. Limitations

The complete honest list, grouped. (1–6 are structural to the current data; 7–12 are method
caveats; 13–17 are engineering/scope.)

1. **No benchmark-beating out-of-sample edge.** The central limitation. **[UPDATED — B9]**
   Best jointly-selected strategy: signal-edge OOS −0.04/PF 0.97; portfolio positive in
   absolute terms but trailing Nifty on its validated era (−6.5% vs +0.8%). Phase 5
   (paper trading) stays correctly gated until the portfolio gate clears "beat Nifty".
2. **Technicals-only in the DECISION path — the orthogonal buckets are empty.**
   **[UPDATED — B5/B7]** Sentiment + Fundamental factors are now ~~not built~~ **built and
   computed**, but held observational (empty buckets), so the composite is still the
   technical score. The weighted factors remain correlated trend/momentum variants — low
   diversity, ρ≈0 discrimination. Activating a bucket is B9's decision, on evidence.
3. **Fundamental factor is data-blocked.** ~~No point-in-time historical fundamentals
   exist.~~ **[RESOLVED — B4/B5, 2026-07-18]** `quarterly_fundamental` holds 1,984
   announcement-dated quarters across 167/167 symbols; `FundamentalFactor` built + measured
   (floor-mechanism favoured, weight held observational). See `FUNDAMENTAL_FACTOR.md`.
4. **Sentiment can't be backtested for ~6 months.** **[SOFTENED — B3.5/B3.6/B6, 2026-07-19]**
   The live clock started 2026-07-18, but the GDELT (media, 2025-01→) + BSE (filings,
   2024-01→) backfills now give ~2.5yr of provenance-tagged, precision-audited, FinBERT-scored
   history — B7 is data-unblocked *now* (validate per-origin; backfilled `availableAt` is
   reconstructed). See `GDELT_BACKFILL.md`, `BSE_BACKFILL.md`, `GDELT_PRECISION_FIX.md`.
5. **BULL remains net-negative** (−0.32 OOS even with the pullback entry). The buy-strength
   style is structurally wrong there, and the pullback style only reduces the damage.
6. **The conviction/composite score is uninformative (ρ ≈ 0)** — yet it drives position
   sizing, so sizing currently adds no value (may subtract). Needs orthogonal signal before
   reweighting/learning can fix it.
7. **Survivorship bias:** the universe is *today's* 166 constituents replayed into the past —
   results are optimistic; delisted/degraded names are absent. **[PARTIALLY ADDRESSED —
   B8.2]** `src/universe/membership.ts` adds point-in-time membership windows, enforced in
   `generateRawSignals`, and the standing rule is **never delete a symbol — set its `to`
   date** so the bias stops compounding going forward. ⚠️ **Open residual:** the
   pre-curation past cannot be repaired without historical NSE index-change records, which
   are not statically fetchable. Revisit before B9's conclusions are treated as final.
8. **Signal-edge ≠ portfolio truth.** **[RESOLVED — B1, 2026-07]** `backtest:run` still takes
   *every* signal (no caps/sizing), and its additive equity curve / max-drawdown remains a
   naive artifact of overlapping trades — but `bun run backtest:portfolio` now simulates one
   ₹2L book with the real caps, sizing and kill switch. **Portfolio truth turned out to be
   *worse* than signal truth** (OOS −12.7% vs the −0.12%/trade near-breakeven reading),
   because a 2-slot book takes only ~15% of signals and compounds the drift.
9. **"Beat Nifty" is now a fair test — and it FAILS.** **[RESOLVED — B1]** ~~A genuine gate
   needs a portfolio-level simulation — not built.~~ It is built, in the same units as the
   benchmark: OOS the book lost −12.7% to −23.4% vs Nifty −4.4%; full window −2.1% vs
   +10.0%. Every sizing mode, both windows, both cost levels. See `PORTFOLIO_BACKTEST.md`.
10. **Short validation history:** the headline research window is ~2 years / 544 days,
    3 walk-forward folds, one market cycle; OOS windows ≈170 days each (one fold positive,
    two negative), fold boundaries calendar-arbitrary. **[IMPROVED — B8.1/B8.3]** OHLCV now
    goes back **5.5yr (1,356 candles/instrument, 2021-01→)**, giving a deep-window baseline
    across cycles (4,394 trades, PF 0.94), and the walk-forward is now **embargoed** (10d)
    so a train-end signal's time-stop can't resolve inside the test window. Statistical
    power is still limited — one market, one cycle family.
11. **Overfitting pressure is real and demonstrated:** both Step 3 and Step 4b looked far
    better in-sample than out. All grids explored here were small, but every future config
    choice must flow through the walk-forward harness — single-window numbers in these docs
    are directional only.
12. **Fixed-cost model:** 5 bps slippage + 0.05%/side commission are assumptions; no live
    fill data. VIX is proxied by Nifty ATR% (no real VIX feed). Manual order placement adds
    untracked human latency vs simulated next-open fills.
13. **agreementScore is uncalibrated** — factor agreement, not statistical confidence.
14. **Regime detection is simple:** EMA50 breadth only (no 52-week hi/lo), no defensive-sector
    logic, threshold-adjust only. CRASH/HIGH_VOL samples in the window are tiny (n=12 for
    HIGH_VOL — its PF 5.49 is noise, not signal).
15. **Sector granularity:** 23 committed sector labels; some sectors have few members (SRS
    goes neutral below 3 peers); sector assignments are static (no reclassification history).
16. **Research levers vs production config:** ~~production runs the baseline~~ **[STALE —
    fixed by B2]** production runs `pullback+srs0.25` (`createProductionStrategy()`). The
    B9-validated additions (ff50 + sf50 floors, volume pruned) remain research levers —
    adopting the B9 stack into production is an **open operator decision** (it dominates
    current production on every window/sizing/cost level measured, `B9_RERUN.md` §4).
17. **Operational gaps vs spec (documented drift):** no intraday thesis checks or pre-market
    job; `snapshotJson` stores the approved signal, not the full factor bundle;
    `instrumentMasterVersion` is best-effort. *(The "no FinBERT sidecar" item was resolved
    by B6 — the sidecar is built, pinned, and deployed.)*

## 17. Current state & what's next

**State:** a complete, reproducible, honestly-measured research platform. **[UPDATED
2026-07-20]** 364 tests + golden gate green; whole stack deployed on AWS
(`DEPLOYMENT_AWS.md`). The Part-B program is **complete through B9**
([`B9_RERUN.md`](./B9_RERUN.md)): both orthogonal factors measured (bucket blends
rejected; floor gates validated — the information lives in the negative tails), volume
pruned on joint evidence, and **one best evaluated strategy** —
`pullback + srs0.25 + ff50 + sf50 − volume` — selected on all 4 coverage-era
walk-forward folds × both origin tiers. Portfolio level: first **positive absolute
returns** (OOS +24.8%, maxDD −11%) — **but still trails Nifty on its validated era
(−6.5% vs +0.8%) → the B10 gate remains failed.** Master tracker:
`ROADMAP_CHECKLIST.md`.

**Highest-leverage next moves:**
1. **Slot-allocation research** — the largest unworked lever: the 2-slot book takes ~14%
   of signals, picked by a ρ≈0 composite ranking; measure better slot-pickers and the
   `maxOpenPositions` dose through `backtest:portfolio`.
2. ⚙️ **Operator decision:** adopt the B9 stack as production config (B2 precedent).
3. Historical-constituent data to kill survivorship bias (§16.7) — open residual;
   re-attempt before treating B9's numbers as final.
4. Let the live archive age — sentiment's strong-evidence tier grows daily; re-run the
   anchored walk-forward as coverage deepens.
5. Only if features ever show discrimination (every Spearman is still ≈0): revisit
   learned weighting through the walk-forward harness (§16.6, §16.11).

**Phase 5 (paper trading) stays gated** until a portfolio-level backtest beats Nifty
risk-adjusted, net of costs, out-of-sample.

---

*Every formula in this file was verified against `src/` at the 149-test state (§§1–14) and
maintained forward; findings/limitations/state are current as of the 364-test state. If
code and this file ever disagree, the code + golden fixture are the truth — update this
file.*
