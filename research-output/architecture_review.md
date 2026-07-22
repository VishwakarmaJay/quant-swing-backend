# Task 1 — Architecture Review

Read-only study of the existing repository to plan a **reuse-first** research layer. No code written.

The research layer must measure `factor score(t) → forward return(t→t+h) → cross-sectional predictive information`, with **zero dependency** on `Trade` / `Position` / exits / portfolio caps / costs. Almost every ingredient already exists; the job is mostly composition, not new code.

---

## 1. Existing modules and what each provides

| Module | Provides | Relevant symbols |
|---|---|---|
| `src/universe/symbols.ts` | Canonicalisation + symbol→instrument maps | `canonicalSymbol`, `byCanonicalSymbol` |
| `src/universe/membership.ts` | **PIT index membership** — is symbol X in the universe on date D | `isMemberOn(symbol, dateIso)` (empty map ⇒ always member) |
| `src/backtest/candleStore.ts` | One in-memory load of **all** candles, benchmark, VIX, PIT fundamentals, scored news | `loadCandleStore()` → `CandleStore{ instruments, seriesById, benchmark, tradingDates, fundamentalsBySymbol, vixByDate, newsBySymbol }` |
| `src/factors/featureBundle.ts` | Runs all factors over one `StockContext` → frozen bundle | `buildFeatureBundle(ctx, factors)` |
| `src/factors/registry.ts` | The 8 registered factors, stable order | `factors` = trend, momentum, relativeStrength, sectorRelativeStrength, volume, volatility, fundamental, sentiment |
| `src/factors/context.ts` | StockContext assembly for the **live** path (DB-backed, per-stock) | `buildStockContext`, `BENCHMARK_ID='NSE:Nifty 50'` |
| `src/fundamentals/asOf.ts` | PIT fundamental snapshot (announcement-dated) | `fundamentalsAsOf(quarters, price, dateIso)` |
| `src/news/sentimentAggregate.ts` | PIT sentiment inputs as-of a cutoff | `sentimentInputsAsOf(articles, asOfMs, windowDays)` |
| `src/regime/detectRegime.ts` | Market-wide regime per date | `detectRegime({asOf, niftyCandles, breadthPct, vix})` → BULL/BEAR/SIDEWAYS/HIGH_VOL/CRASH |
| `src/backtest/backtestEngine.ts` | Full replay: per-date cross-sectional pre-pass + `buildFeatureBundle` per member, **gated to passing signals** | `generateRawSignals` (inline pre-pass, lines 82–201) |
| `src/backtest/attribution.ts` | **Tie-averaged rank + Spearman** (the correct rank-correlation primitive) | `rank` (24–36), `spearman` (62–65) — the good half of the otherwise-defective module |
| `src/events/eventStudy.ts` | Forward-excess math + per-cell stats with normal-approx CI, p90/p10 | `measureEvent`, `cellStats`, `HORIZONS` |
| `src/delivery/metrics.ts` | **Generic cross-sectional decile bucketing** | `bucketByRank<T>(items, valueOf, n=10)` |
| `src/scripts/runDeliveryStudy.ts` | **The decile-study harness** — per-day cross-sectional deciles on forward excess, day-after aligned | inline `forwardExcess`, `decileStudy` |

---

## 2. Classification

### REUSE UNCHANGED — import and call directly
- `attribution.ts` → `spearman`, `rank` — **the** rank-IC primitive (tie-averaged mid-ranks; already verified correct). Per-date Spearman IC = `spearman(scores_d, labels_d)` per date, then average.
- `delivery/metrics.ts` → `bucketByRank` — generic `<T>`; assigns decile indices to any observation set by any accessor. Exactly the decile engine.
- `eventStudy.ts` → `cellStats` (decile-cell mean, SE, normal-approx CI, hit%, p90/p10), `HORIZONS`/`Horizon` (extend the horizon set — see below).
- `candleStore.ts` → `loadCandleStore`, `CandleStore`, `benchmarkReturn`. Single source of all series.
- `universe/membership.ts` → `isMemberOn`. PIT membership, unchanged.
- `universe/symbols.ts` → `canonicalSymbol`, `byCanonicalSymbol`.
- `regime/detectRegime.ts` → `detectRegime` for the per-date regime split.
- `factors/registry.ts` → `factors`; `factors/featureBundle.ts` → `buildFeatureBundle`.
- PIT leaves: `fundamentalsAsOf`, `sentimentInputsAsOf`, `emaLatest`, `lookbackReturnPct`, `assessDataQuality`.

### EXTRACT AND REUSE — currently inline in a script; lift into `src/research/`
- **`forwardExcess`** (`runDeliveryStudy.ts:104–119`). The alignment logic (trading-day, day-after entry, excess vs benchmark) is exactly what we need — but it lives as a closure and returns **excess only**. Lift into a pure module and generalise to return **both** raw `fwd` and market-excess `xs` from the same `(dates, closes, benchByDate, date, h)` inputs.
- **The per-day cross-sectional decile loop** (`decileStudy`, `runDeliveryStudy.ts:122–163`). The *pattern* — group by date, `bucketByRank` within date, accumulate forward returns per decile — is the reusable core. It is currently coupled to `Obs`, to a single horizon, to console output, and to EW-only. Lift the pattern; parameterise the rest (see REFACTOR).

### REFACTOR — needs generalising
- **Decile study → `quantiles.ts`**: accept an arbitrary factor accessor `(row)→number|null`, a label accessor `(row)→number|null`, **EW and VW** weighting (delivery study is EW-only via `cellStats`), and emit structured rows for CSV instead of `console.log`. Reuses `bucketByRank` + `cellStats` internally.
- **Forward labels → `forwardLabels.ts`**: generalise `forwardExcess` to emit the full `ForwardLabel` (fwd/xs at all 6 horizons) per `(date, symbol)`, `null` when insufficient, never imputed.
- **Rank IC → `rankIC.ts`**: *new composition* over the reused `spearman` — per-date IC, mean, std, ICIR = mean/std, Newey-West t-stat. `spearman` reused; the averaging/NW layer is genuinely new (nothing in the repo does per-date IC or NW).

### LEAVE UNTOUCHED — frozen baseline / production path / historical-compat
- `attribution.ts` **behaviour** (constraint #3; outputs cited across `doc/review/`). Only a clarifying docstring may be added. We **import** `spearman`/`rank` from it; we do not change it.
- `DEFAULT_STRATEGY_CONFIG`, `createProductionStrategy`, every factor's scoring logic and config (constraint #1) — byte-identical.
- `tradeSimulator.ts`, `backtestEngine.ts` replay behaviour, golden fixtures. (Task 9's MFE/MAE additions are *additive fields only*, conditional, and gated on golden tests still passing — out of scope until Task 8 turns up signal.)

---

## 3. Specific answers

### Q1 — Which `runDeliveryStudy.ts` functions lift unchanged vs need generalising?
- **Lift, but generalise (not unchanged):** `forwardExcess` — needs to also return the **raw** return (currently excess-only) and be decoupled from its captured maps.
- **Reuse unchanged (already generic, just imported by the script):** `bucketByRank` (from `delivery/metrics`), `cellStats` + `HORIZONS` (from `eventStudy`). These are the parts of the harness that are *already* library-grade.
- **Generalise from delivery-metric to arbitrary factor accessor:** `decileStudy`. Today `valueOf: (o: Obs) => number|null` is a delivery accessor and the label is hard-wired to `forwardExcess(...horizon)`. The research version takes any factor accessor and any label variant (`fwd`/`xs`/`resid`), adds VW, and returns rows instead of printing.

### Q2 — Does `forwardExcess()` count trading or calendar days? Day-after alignment?
**Trading days, day-after aligned — confirmed** (`runDeliveryStudy.ts:104–119`). It indexes into the per-symbol trading-date array: `i = dates.indexOf(date)`, entry `d0 = dates[i+1]`, exit `d1 = dates[i+1+h]`. So `h` steps are **trading bars**, and entry is the **next bar** after the observation date (matching the simulator's next-open discipline; comment at 109). This is exactly the convention the research labels must use, and it is *different* from the simulator's calendar-day `timeStopDays` (Phase-0 item 5). `eventStudy.measureEvent` is likewise trading-day/anchor-next-bar (`anchorIndex` = first close strictly after cutoff, then `candles[a+h]`).

### Q3 — What is missing vs the target design?
The delivery/event harness gives cross-sectional deciles + normal-approx CIs. Missing, and therefore genuinely-new composition in `src/research/`:
| Target statistic | Exists? | Where it must come from |
|---|---|---|
| Per-date **rank IC** (mean of daily Spearman) | ❌ (deciles only) | new `rankIC.ts` over reused `spearman` |
| **Newey-West** t-stat on the IC series | ❌ | new in `rankIC.ts` |
| **ICIR** (mean/std of daily IC) | ❌ | new in `rankIC.ts` |
| **Value-weighting** | ❌ (EW only) | new in `quantiles.ts` (size proxy — see note) |
| **Residualisation** (β + sector + size) | ❌ | new `residualize.ts` |
| **Regime splits** | ❌ in studies | reuse `detectRegime`, attach per-date |
| **Stationary block bootstrap CI** | ❌ (normal-approx only) | new `statistics.ts` |
| **Raw `fwd`** (non-excess) labels | ❌ (excess only) | generalise `forwardExcess` |
| Horizons 21, 63 | ❌ (`HORIZONS`=[1,3,5,10]) | extend horizon set in research layer (do not mutate `eventStudy.HORIZONS`) |

### Q4 — Can `buildFeatureBundle` be driven directly, or is the full replay loop required?
**`buildFeatureBundle(ctx, factors)` is a pure function and can be driven directly** — but building its `ctx: StockContext` requires the **per-date cross-sectional pre-pass**: sector peer returns, sector P/E ranking, `fundamentalsAsOf`, `sentimentInputsAsOf`, the benchmark slice, breadth, and `detectRegime`. That pre-pass exists **only inline inside `generateRawSignals`** (`backtestEngine.ts:82–178`), and that loop additionally:
- filters to **gate-passing** signals (`if (!evaluation.passed) continue`),
- applies the **DQ ≥ 0.8** screen and the **5-day resignal cooldown**.

A factor panel needs **every** universe member on **every** date, ungated. So `generateRawSignals` **cannot** be reused as-is.

**Recommendation (keeps the production path byte-identical):** a new `panelBuilder.ts` that mirrors the pre-pass by **importing every leaf helper** already used by the engine (`buildFeatureBundle`, `factors`, `emaLatest`, `lookbackReturnPct`, `fundamentalsAsOf`, `sentimentInputsAsOf`, `assessDataQuality`, `detectRegime`, `isMemberOn`, `canonicalSymbol`) and emits **all** members' factor scores + composite + regime + a size proxy, with **no** gate/cooldown/DQ filter (DQ recorded as a column so it can be a *split*, per audit H-3, not a silent exclusion). This duplicates only the *orchestration*, not any business logic, and touches nothing on the production path.

**Alternative (cleaner, riskier):** extract the pre-pass from `generateRawSignals` into a shared exported `buildContextsAsOf(store, asOf)` that both the engine and the panel builder call. This is the more "institutional" factoring and removes the orchestration duplication, but it edits the production replay file and **must** be validated against the golden fixtures before acceptance. Given constraints #1/#2, I lean toward the import-the-leaves approach unless the golden suite makes extraction demonstrably safe.

---

## 4. Notable constraints surfaced for the design (Task 2)

- **No market-cap field.** `Candle = {tradeDate, open, high, low, close, volume}` — no shares outstanding. The **size proxy** (for VW weighting and residualisation) must be turnover-based: `ADV = close × volume` (rolling median), with `log(ADV)` as the size regressor. This is a documented approximation of "value-weight," not true market-cap weight — state it in `quantiles.ts`/`residualize.ts` docstrings and in the summary.
- **`xs` labels subtract a PRI Nifty** (Phase-0 item 2) — dividend-understated benchmark; caveat carries into `xs` and `resid`, not `fwd`.
- **Trading-day convention** must be declared in every research docstring (Task 7). Labels are trading-day; the simulator stop is calendar-day; a 7-cal-day exit ≈ `fwd5`.
- **Regime** is market-wide per date, so it is a per-date column on the panel; a split, not a re-computation per stock.
- **Two validation gates are distinct** (Task 6): Gate A (synthetic/inverse/shuffled) is a deterministic harness property — failure = bug = stop. Gate B (12-1 momentum, + reversal fallback) is diagnostic — a soft failure does not by itself condemn the harness.

---

## 5. Proposed `src/research/` layout (preview for Task 2)

```
forwardLabels.ts   generalises forwardExcess → {fwd,xs} × 6 horizons, trading-day, never imputed
panelBuilder.ts    mirrors the engine pre-pass; drives buildFeatureBundle over ALL members → panel
rankIC.ts          per-date spearman (reused) → meanIC, stdIC, icIR, tStat, neweyWestTStat, nDates
quantiles.ts       bucketByRank (reused) + cellStats (reused) → EW & VW decile spreads
residualize.ts     regress label on {β, sector dummies, log-ADV} → residual label
statistics.ts      stationary block bootstrap 95% CI
report.ts          CSV emission to research-output/
```
Reused-vs-new is spelled out per module in Task 2's dependency graph.

**Bottom line:** the ranking primitive (`spearman`), the decile engine (`bucketByRank`), the cell stats (`cellStats`), the alignment logic (`forwardExcess`), and all PIT/candle/universe/benchmark machinery **already exist and are correct**. The only genuinely new code is the per-date IC/Newey-West/ICIR layer, VW weighting, residualisation, and the block bootstrap — plus an ungated panel builder that reuses the engine's leaf helpers.
