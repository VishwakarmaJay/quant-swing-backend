# QuantSwing — Evidence Request for Final Verdict

**Not a review.** This document specifies the minimum set of artifacts required to collapse the hypothesis space to a single scientifically defensible conclusion.

---

## 0. The hypothesis space I am trying to partition

Everything below exists to discriminate between exactly five hypotheses:

| | Hypothesis |
|---|---|
| **H1** | The features contain no cross-sectional predictive information. The conclusion is correct. |
| **H2** | Information exists, but the estimator/label could not detect it. Measurement failure. |
| **H3** | Information exists, but the exit policy destroyed it. Execution failure. |
| **H4** | Information exists, but a 2-slot portfolio could not express it. Construction failure. |
| **H5** | The price series is corrupt, so all results — yours and my critique of them — are void. Data failure. |

These are diagnosable in a strict order. **H5 first** (it voids everything downstream), then **H2** (instrument validity), then **H1 vs H3/H4** (does the signal exist at all, and if so where did it die).

I am not asking for anything that fails to discriminate among these five.

---

## 1. Remaining Unknowns

| # | Unknown | Why it matters | Conclusion it determines | Level | Information gain | Time | Existing data sufficient? |
|---|---|---|---|---|---|---|---|
| **U1** | **Methodology of B12/B13 studies** — were they cross-sectional forward-return decile studies, or did they route through the trade/exit pipeline? | If cross-sectional, those two negatives are methodologically sound *and* the infrastructure for the master test already exists. My "all six negatives share one flaw" claim is then partly wrong. | Whether the existing evidence base is stronger than I judged; whether Gate 2 is a new build or a re-run | **Critical** | Very high | 30 min (read the script) | ✅ Yes |
| **U2** | **Exact ρ formula** — pooled Spearman over all (stock,date) pairs, vs per-date cross-sectional rank IC averaged with Newey-West | Pooled ρ across a panel is dominated by cross-sectional variance in the market factor and is near-meaningless as a predictive measure. Cross-sectional rank IC is the correct estimator. | Whether "ρ≈0 for every factor" is real evidence or an artifact. Directly decides H1 vs H2. | **Critical** | Very high | 30 min (read code) | ✅ Yes |
| **U3** | **Price series integrity** | Two adjustment bugs already found. Corrupted ATR directly manufactures the "stopped out of winners" pattern you observed. | H5. Voids everything if positive. | **Critical** | Very high (asymmetric) | 2–3 days | ✅ Yes |
| **U4** | **MFE vs realized return per trade** | If maximum favourable excursion is large but realized return small, exits destroyed the edge. If MFE is also small, no edge existed. | **H3 vs H1.** Single most discriminating statistic available. | **Critical** | Very high | 1–2 days | ✅ Yes |
| **U5** | **Quantile spread on raw forward returns, portfolio-free, exit-free** | Bypasses exits, gates, slots and costs entirely. Measures whether the composite ranks stocks. | **The master test. H1 directly.** | **Critical** | Highest of any item | 2–3 days | ✅ Yes |
| **U6** | **Positive control result** — does a known anomaly (12-1 momentum, Piotroski F) survive the pipeline? | If a decades-replicated anomaly also dies in your pipeline, the instrument is broken and no negative is informative. | **H2.** Validates or invalidates every prior result. | **Critical** | Very high | 3–5 days | ✅ Yes |
| **U7** | **Portfolio outcome at 2 vs 20 vs 50 slots, same signal** | Directly tests whether concentration destroyed an expressible signal. Settles B11. | **H4.** | **Critical** | Very high | 2–3 days | ✅ Yes |
| **U8** | **Actual position concurrency distribution** | If typical concurrency is 0–1 rather than 2, effective breadth is even lower than I assumed. | Magnitude of H4 | **Critical** | High | 2 hours | ✅ Yes |
| **U9** | **Reconciliation of −6.5% vs −17.08% COVERAGE** | Same window, same sizing, 10.6pp apart. One is wrong. This is the decisive gate metric. | Trustworthiness of the headline conclusion | **Critical** | High | 0.5 day | ✅ Yes |
| **U10** | **Factor value distributions** — especially Trend's mass across its 5 discrete states, and RS clamp saturation rate | A factor with 60%+ mass at one value has near-zero cross-sectional discrimination. Mechanical explanation for composite failure. | H2 mechanism | **Important** | High | 1 day | ✅ Yes |
| **U11** | **Non-null rate of Sentiment and Fundamental factors** | Neutral-50 imputation dilutes a real signal toward zero proportional to missingness. If Sentiment is null 80% of the time, B7 measured almost nothing. | Validity of B5/B7/B9 floor gates | **Important** | High | 1 day | ✅ Yes |
| **U12** | **Factor correlation matrix / effective rank** | If ρ(Trend,Momentum,RS) > 0.6, the "4-factor composite" is a 1-factor composite and diversification is illusory. | H2 mechanism | **Important** | Med-high | 0.5 day | ✅ Yes |
| **U13** | **IC decay curve across horizons 1→63d** | A signal with a 40-day half-life held for 7 days is being churned, not exploited. | Whether the horizon, not the signal, is wrong | **Important** | High | 1–2 days | ✅ Yes |
| **U14** | **Effective sample size** — mean pairwise correlation of daily cross-sectional returns | 4,394 trades sharing a market factor is not 4,394 independent observations. Every t-stat scales by √(ESS/n). | Magnitude of all statistical claims | **Important** | Med-high | 1 day | ✅ Yes |
| **U15** | **Dividend adjustment status** | If unadjusted, every high-yield name carries systematic negative drift, biasing against value/quality. | Data validity, H5-adjacent | **Important** | 2 hours | ✅ Yes |
| **U16** | **Regime-conditional IC** | An unconditional null can be the average of a positive BULL IC and a negative BEAR IC. | Whether conditional signal exists | **Important** | Med-high | 1–2 days | ✅ Yes |
| **U17** | **Total trial count** across the whole research program | Denominator for deflated Sharpe. Without it, no OOS number can be discounted honestly. | Discount applicable to B9 | **Important** | Medium | 0.5 day | ✅ Yes |
| **U18** | **Restatement handling in `quarterly_fundamental`** | Overwrite-on-restate is silent lookahead into B5 and the production `fundamentalFloor`. | B5/B9 validity | **Important** | Medium | 0.5 day | ✅ Yes |
| **U19** | **Signal-set overlap across studies** | Tests my claim that the negatives are correlated. If B5/B7/B9 ran on largely the same trades, they are near-duplicate experiments. | How much independent evidence exists | **Optional** | Medium | 1 day | ✅ Yes |
| **U20** | **Rolling 12-month IC per factor** | Distinguishes "never worked" from "worked then decayed". | Non-stationarity | **Optional** | Medium | 1 day | ✅ Yes |

**Every unknown is answerable from data you already hold. Nothing here requires a purchase.**

### What I am deliberately NOT asking for, and why

| Not asking | Reason |
|---|---|
| Code quality, test coverage, CI config | Established as excellent; cannot change the alpha verdict |
| News scraper internals, WAF handling, dedup mechanics | Thoroughly documented; does not discriminate H1–H5 |
| Backup/S3/CRR setup, Telegram delivery, ops | Irrelevant to the scientific question |
| B12 event-type detail beyond methodology (U1) | The negative is clear; only the *method* matters |
| B13 delivery detail beyond methodology (U1) | Same |
| Option C vendor pricing | A spend decision, not a scientific one |
| Midcap spike internals | Already established as a transfer test, not an alpha test |
| Survivorship repair detail | Well-executed; residual is small and known |

---

## 2. Exact Questions

### LEVEL 1 — Required before any conclusion

**Q1.** Provide the source file and function that computed the Spearman correlation reported as "ρ ≈ 0 for every factor and the composite." I need to see whether the computation is:
```
(a) spearman(all_observations_pooled)                    ← pooled, near-meaningless
(b) mean_t[ spearman_t(factor_scores, forward_returns) ] ← cross-sectional rank IC, correct
```
Specifically: `src/backtest/attribution.ts` (or wherever `spearman`/`rankCorrelation` is defined and called). **Paste the function body and the call site.**

**Q2.** For `events:study` (B12) and `delivery:study` (B13): state whether forward returns were computed as
```
(a) raw forward return over N days from the event date, cross-sectionally ranked into deciles, or
(b) returns realized through the trade simulator's exit policy
```
Provide `src/events/study.ts` and `src/delivery/study.ts` (or equivalent paths). **This determines whether you already have a working cross-sectional study harness.**

**Q3.** Provide a trade-level ledger CSV, one row per trade, for the B9 production config over the FULL window, with exactly these columns:
```
symbol, sector, signalDate, entryDate, entryPx, exitDate, exitPx, exitReason,
holdingDays, grossRetPct, netRetPct, costPct,
mfePct, maePct,                          ← ADD THESE (see Q4)
slPx, t1Px, t2Px, riskPerShare, atrPct,
regime, composite, agreement,
trend, momentum, relativeStrength, sectorRelativeStrength, volume, volatility,
fundamental, sentiment,
fundamentalIsNull, sentimentIsNull       ← ADD THESE
```
Filename: `ledger_b9_full.csv`

**Q4.** MFE/MAE are almost certainly not currently computed. Add to `TradeSimulator`:
```
mfePct = (max(high[t]) over holding period − entryPx) / entryPx × 100
maePct = (min(low[t])  over holding period − entryPx) / entryPx × 100
```
computed over the **actual realized holding window**, and additionally over a **fixed 21-day window ignoring exits** (`mfe21Pct`, `mae21Pct`). Re-run and include in the Q3 ledger.

**Q5.** Run the **portfolio-free cross-sectional quantile study** — this is the master experiment. Specification:
- For every trading day in the FULL window, for every universe member passing data quality
- Compute the composite score (production config), **no gates applied**
- Rank into deciles cross-sectionally
- Compute forward raw return at h ∈ {1, 3, 5, 10, 21, 63} trading days
- Also compute forward **market-excess** return (`r_stock − r_nifty`) at each h
- Output: mean and median forward return per decile per horizon, plus Q10−Q1 spread with a Newey-West t-stat

Deliverable: `quantile_study.csv` with columns `horizon, decile, nObs, meanRet, medianRet, meanExcessRet, stdRet` plus `quantile_spread.csv` with `horizon, spread, tStat, neweyWestTStat`.

**Q6.** Run the same quantile study **for each of the 8 factors individually** (not just the composite). Same output format, additional column `factorName`. Deliverable: `quantile_study_by_factor.csv`.

**Q7.** Run the **positive control**. Implement two signals that have nothing to do with your existing factors:
```
momentum_12_1 = (close[t-21] / close[t-252]) − 1        // skip most recent month
piotroski_f   = 9-point F-score from quarterly_fundamental
```
Push both through (a) the Q5 quantile harness, and (b) the full production pipeline including gates, exits, and the 2-slot portfolio. Deliverables: `positive_control_quantile.csv`, `positive_control_portfolio.txt`.

**Q8.** Run the **breadth experiment**: identical signal set (B9 production), identical period, identical costs, three portfolios:
```
(i)   maxOpenPositions = 2,  maxPerSector = 1   ← as-built
(ii)  maxOpenPositions = 20, maxPerSector = 3,  equal-weight
(iii) maxOpenPositions = 50, maxPerSector = 5,  equal-weight
```
Deliverable: `breadth_comparison.csv` with `variant, totalReturn, cagr, maxDD, sharpe, exposureAvg, nTrades, turnover` plus the three daily equity curves as `equity_curves_breadth.csv`.

**Q9.** Provide the actual concurrency time series: for each trading day, how many positions were open under the as-built 2-slot config. Deliverable: `concurrency.csv` (`date, openPositions`), plus the histogram.

**Q10.** Reconcile the COVERAGE discrepancy. Provide, for **both** the `B9_RERUN.md` run and the `SURVIVORSHIP.md` baseline run:
- exact command line invoked
- exact date range (`from`, `to`)
- `PORTFOLIO_SIZING_MODE`, `PORTFOLIO_BASE_CAPITAL`, `maxOpenPositions`, `maxPerSector`
- `weightsVersion` and `engineVersion`
- number of trades
- the console output / report file

Deliverable: `coverage_reconciliation.md`.

**Q11.** Run the price integrity SQL block in §6 and provide raw output as `price_audit.txt`.

### LEVEL 2 — Would significantly increase confidence

**Q12.** Export the full factor panel: for every `(date, symbol)` in the FULL window, every factor's **score AND its pre-clamp raw inputs**:
```
date, symbol, factorName, score, agreementContribution, isNull,
rawValue                          ← e.g. raw excess return before clamp(x/20,±1),
                                  //     raw RSI, raw atrPct, raw P/E percentile,
                                  //     raw sentiment weighted mean, raw sector percentile
```
Deliverable: `factor_panel.parquet` (or CSV if easier).

**Q13.** From that panel, provide:
- histogram of `Trend` across its 5 discrete values (what % sits at each of 0/25/50/75/100)
- % of `RelativeStrength` observations where `|excess| ≥ excessCapPct` (clamp saturation rate)
- % of `SectorRelativeStrength` observations at exactly 50 (insufficient-peers fallback)
- non-null rate for `Fundamental` and `Sentiment`, by year

Deliverable: `factor_distributions.md` + charts (§7).

**Q14.** Compute the 8×8 factor correlation matrix (Spearman, cross-sectional, averaged across dates) and its eigenvalue spectrum. Deliverable: `factor_correlation.csv` + `factor_eigenvalues.csv`.

**Q15.** Compute the IC decay curve: mean cross-sectional rank IC per factor at h ∈ {1,2,3,5,7,10,15,21,42,63}. Deliverable: `ic_decay.csv` (`factorName, horizon, meanRankIC, stdRankIC, icIR, neweyWestTStat, nDates`).

**Q16.** Compute effective sample size:
```
rho_bar = mean pairwise correlation of daily returns across universe members
ESS     = n_trades / (1 + (avg_concurrent_trades − 1) × rho_bar)
```
Provide `rho_bar`, average concurrency in the *signal-edge* backtests (not the 2-slot portfolio), and resulting ESS for the 981-trade and 4,394-trade studies. Deliverable: `effective_sample_size.md`.

**Q17.** State the total number of distinct configurations, parameter values, factor variants, floor levels, horizons, and windows evaluated across the entire research program (A1–B16). An honest estimate with a breakdown by study is fine. Deliverable: `trial_count.md`.

**Q18.** Confirm whether `ohlcv.close` is dividend-adjusted. If yes, provide the adjustment source and method. If no, state so. Deliverable: one line in `data_provenance.md`.

**Q19.** Compute regime-conditional rank IC: mean cross-sectional rank IC per factor, split by regime (BULL/BEAR/SIDEWAYS/HIGH_VOL). Deliverable: `ic_by_regime.csv`.

**Q20.** For `quarterly_fundamental`: run the restatement query in §6 and state whether rows are ever `UPDATE`d in place or always appended. Deliverable: output + one-line answer.

### LEVEL 3 — Nice to have

**Q21.** Permutation test: shuffle forward-return labels within each date 1,000 times; report where the observed composite rank IC falls in the null distribution. Deliverable: `permutation_test.csv`.

**Q22.** PBO via CSCV over the 8-config walk-forward selection. Deliverable: `pbo.md`.

**Q23.** Rolling 12-month rank IC per factor. Deliverable: `rolling_ic.csv` + chart.

**Q24.** Signal-set overlap: Jaccard similarity of the trade sets used in B5, B7, B9, B11, B14. Deliverable: `study_overlap.csv`.

---

## 3. Required Files

| Level | Filename | Contents |
|---|---|---|
| 1 | `ledger_b9_full.csv` | Trade ledger with MFE/MAE (Q3, Q4) |
| 1 | `quantile_study.csv` | Composite decile forward returns (Q5) |
| 1 | `quantile_spread.csv` | Q10−Q1 with t-stats (Q5) |
| 1 | `quantile_study_by_factor.csv` | Per-factor deciles (Q6) |
| 1 | `positive_control_quantile.csv` | Known-anomaly deciles (Q7) |
| 1 | `positive_control_portfolio.txt` | Known-anomaly through full pipeline (Q7) |
| 1 | `breadth_comparison.csv` | 2/20/50 slot outcomes (Q8) |
| 1 | `equity_curves_breadth.csv` | Daily equity, three variants (Q8) |
| 1 | `concurrency.csv` | Open positions per day (Q9) |
| 1 | `coverage_reconciliation.md` | The −6.5%/−17.08% resolution (Q10) |
| 1 | `price_audit.txt` | SQL output (Q11) |
| 2 | `factor_panel.parquet` | Full factor panel with raw values (Q12) |
| 2 | `factor_distributions.md` | Degeneracy/saturation analysis (Q13) |
| 2 | `factor_correlation.csv`, `factor_eigenvalues.csv` | Effective rank (Q14) |
| 2 | `ic_decay.csv` | IC vs horizon (Q15) |
| 2 | `effective_sample_size.md` | ESS computation (Q16) |
| 2 | `trial_count.md` | Trial denominator (Q17) |
| 2 | `data_provenance.md` | Dividend adjustment status (Q18) |
| 2 | `ic_by_regime.csv` | Conditional IC (Q19) |
| 3 | `permutation_test.csv`, `pbo.md`, `rolling_ic.csv`, `study_overlap.csv` | (Q21–Q24) |

---

## 4. Required Code

| # | Path (expected) | What I need |
|---|---|---|
| C1 | `src/backtest/attribution.ts` | The Spearman/rank-correlation function body + every call site (Q1) |
| C2 | `src/events/study.ts` | Forward-return computation method (Q2) |
| C3 | `src/delivery/study.ts` | Decile construction + forward-return method (Q2) |
| C4 | `src/backtest/tradeSimulator.ts` | Full file — I need to verify exit priority, fill assumptions, and cost application |
| C5 | `src/backtest/portfolioSimulator.ts` | Full file — sizing, slot allocation, entries-before-exits ordering |
| C6 | `src/backtest/metrics.ts` | Expectancy, PF, Sharpe, drawdown formulas as implemented |
| C7 | `src/backtest/walkForward.ts` | Fold construction, embargo implementation, candidate selection rule |
| C8 | `src/strategy/productionStrategy.ts` | Confirm the exact live config |
| C9 | `src/portfolio/portfolioManager.ts` | Risk-sizing formula as implemented |
| C10 | `src/ohlcv/bhavcopyOhlcv.ts` | `backAdjustSplits` current implementation |

**Why C4–C6 specifically:** the expectancy and PF definitions determine whether "−0.04%/trade, PF 0.97" means what I assumed. A PF computed on gross vs net, or on a per-trade vs per-rupee basis, changes the interpretation materially.

---

## 5. Required Reports

| # | Report | Purpose |
|---|---|---|
| R1 | Raw console output of `backtest:portfolio` for the B9 COVERAGE run | Reconciliation (Q10) |
| R2 | Raw console output of `backtest:portfolio` for the SURVIVORSHIP baseline COVERAGE run | Reconciliation (Q10) |
| R3 | Raw output of `backtest:phase6` showing per-fold train/test windows, candidate scores, selection | Verify the walk-forward is what it claims |
| R4 | Raw output of `backtest:attribution` (the run that produced ρ≈0) | Verify against C1 |
| R5 | Raw output of `backtest:slots` (B11) | Verify the random control construction and n |
| R6 | `DataQualityService` rejection counts by year | Feed degradation over time |

---

## 6. Required SQL Queries

Run these against the production DB and return raw output.

```sql
-- P1. Duplicate OHLCV keys (must return zero rows)
SELECT "instrumentId", "tradeDate", COUNT(*) AS n
FROM ohlcv
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- P2. Extreme daily returns — every row must be explainable
WITH r AS (
  SELECT o."instrumentId", i.symbol, o."tradeDate", o.close,
         LAG(o.close) OVER (PARTITION BY o."instrumentId" ORDER BY o."tradeDate") AS prev_close
  FROM ohlcv o
  JOIN instrument i ON i.id = o."instrumentId"
  WHERE i."instrumentType" = 'EQ'
)
SELECT symbol, "tradeDate", prev_close, close,
       ROUND(((close / prev_close) - 1) * 100, 2) AS ret_pct
FROM r
WHERE prev_close > 0
  AND ABS((close / prev_close) - 1) > 0.20
ORDER BY ABS((close / prev_close) - 1) DESC;

-- P3. Stale price runs (identical close 3+ consecutive days)
WITH s AS (
  SELECT i.symbol, o."tradeDate", o.close,
         LAG(o.close,1) OVER w AS c1,
         LAG(o.close,2) OVER w AS c2
  FROM ohlcv o
  JOIN instrument i ON i.id = o."instrumentId"
  WHERE i."instrumentType" = 'EQ'
  WINDOW w AS (PARTITION BY o."instrumentId" ORDER BY o."tradeDate")
)
SELECT symbol, COUNT(*) AS stale_runs
FROM s
WHERE close = c1 AND c1 = c2
GROUP BY symbol
ORDER BY stale_runs DESC
LIMIT 50;

-- P4. OHLC internal consistency violations
SELECT i.symbol, o."tradeDate", o.open, o.high, o.low, o.close, o.volume
FROM ohlcv o
JOIN instrument i ON i.id = o."instrumentId"
WHERE o.high < o.low
   OR o.high < GREATEST(o.open, o.close)
   OR o.low  > LEAST(o.open, o.close)
   OR o.open <= 0 OR o.close <= 0 OR o.high <= 0 OR o.low <= 0
   OR o.volume < 0;

-- P5. Candle coverage per symbol per year (spot the gaps)
SELECT i.symbol,
       EXTRACT(YEAR FROM o."tradeDate") AS yr,
       COUNT(*) AS candles
FROM ohlcv o
JOIN instrument i ON i.id = o."instrumentId"
WHERE i."instrumentType" = 'EQ'
GROUP BY 1, 2
ORDER BY i.symbol, yr;

-- N1. News coverage density — the number that decides whether B7 measured anything
WITH per_symbol_month AS (
  SELECT UNNEST(symbols) AS sym,
         DATE_TRUNC('month', "availableAt") AS mth,
         COUNT(*) AS n_articles
  FROM news_article
  WHERE array_length(symbols, 1) > 0
  GROUP BY 1, 2
)
SELECT mth,
       COUNT(DISTINCT sym)                                       AS symbols_covered,
       ROUND(AVG(n_articles), 1)                                 AS mean_articles,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n_articles)   AS median_articles,
       PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY n_articles)   AS p10_articles,
       SUM(CASE WHEN n_articles >= 3 THEN 1 ELSE 0 END)          AS symbols_ge_3
FROM per_symbol_month
GROUP BY mth
ORDER BY mth;

-- N2. Coverage by origin over time (is the "coverage era" mostly reconstructed GDELT?)
SELECT DATE_TRUNC('month', "availableAt") AS mth, origin, COUNT(*) AS n
FROM news_article
GROUP BY 1, 2
ORDER BY 1, 2;

-- N3. availableAt sanity — must return zero rows
SELECT COUNT(*) AS violations
FROM news_article
WHERE "availableAt" > "fetchedAt"
   OR "availableAt" < "publishedAt" - INTERVAL '1 day';

-- N4. Unscored article rate
SELECT origin,
       COUNT(*)                                                   AS total,
       SUM(CASE WHEN "sentimentScore" IS NULL THEN 1 ELSE 0 END)  AS unscored
FROM news_article
GROUP BY origin;

-- F1. Fundamentals: fallback reliance (how real is the PIT guarantee?)
SELECT COUNT(*) AS total,
       SUM(CASE WHEN "announcedAt" IS NULL THEN 1 ELSE 0 END) AS using_fallback,
       ROUND(100.0 * SUM(CASE WHEN "announcedAt" IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_fallback
FROM quarterly_fundamental;

-- F2. Announcement lag distribution (values < 20 days are suspicious)
SELECT WIDTH_BUCKET(EXTRACT(DAY FROM ("announcedAt" - "periodEnd")), 0, 180, 18) AS bucket,
       MIN(EXTRACT(DAY FROM ("announcedAt" - "periodEnd"))) AS min_days,
       MAX(EXTRACT(DAY FROM ("announcedAt" - "periodEnd"))) AS max_days,
       COUNT(*) AS n
FROM quarterly_fundamental
WHERE "announcedAt" IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- F3. Restatement detection — duplicate (symbol, period) implies append-on-restate
SELECT symbol, "periodEnd", COUNT(*) AS versions
FROM quarterly_fundamental
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY versions DESC
LIMIT 50;

-- S1. Rejection reason distribution — where candidates actually die
SELECT stage, reason, COUNT(*) AS n
FROM signal_rejection
GROUP BY 1, 2
ORDER BY n DESC;

-- S2. Approved signals per run (live sparsity check)
SELECT DATE_TRUNC('month', "asOf") AS mth,
       COUNT(DISTINCT id) AS runs,
       SUM("approvedCount") AS approved
FROM signal_run
GROUP BY 1 ORDER BY 1;
```

---

## 7. Required Charts

| # | Chart | What it must show | Decides |
|---|---|---|---|
| **CH1** | **Decile bar chart** — mean forward return by composite decile, one panel per horizon {1,5,10,21,63} | Monotonicity and Q10−Q1 magnitude | **H1 directly. The single most important chart.** |
| **CH2** | Same, one panel per factor (8 panels) | Which factor, if any, ranks | Where residual signal lives |
| **CH3** | **MFE vs realized scatter** — x = `mfe21Pct`, y = `netRetPct`, one point per trade, with `y = x` reference line | If mass sits far below the diagonal, exits are destroying edge | **H3** |
| **CH4** | MAE histogram with the median stop distance overlaid as a vertical line | Whether stops sit inside the noise band | H3 mechanism |
| **CH5** | **IC decay curve** — rank IC vs horizon, one line per factor, with zero line and CI band | Signal half-life vs 7-day hold | Horizon mismatch |
| **CH6** | **Three equity curves overlaid** — 2 / 20 / 50 slots, plus Nifty | Whether breadth changes the outcome | **H4** |
| **CH7** | Concurrency histogram — distribution of open positions per day | True effective breadth | H4 magnitude |
| **CH8** | Trend factor value histogram (5 bars) | Degeneracy | H2 mechanism |
| **CH9** | RS raw excess-return histogram with ±20% clamp bounds marked | Saturation rate | H2 mechanism |
| **CH10** | Factor correlation heatmap (8×8) | Effective rank | H2 mechanism |
| **CH11** | Sentiment/Fundamental non-null rate over time (stacked area) | Whether B7/B5 had data | Validity of floor gates |
| **CH12** | Positive-control decile chart, same format as CH1 | Whether the instrument works | **H2. Second most important chart.** |
| **CH13** | Rolling 12-month rank IC per factor | Decay vs never-worked | Non-stationarity |
| **CH14** | News articles-per-symbol-per-month distribution (box plot by year) | Archive usability | B7 validity |

---

## 8. Required Statistics

Report each with point estimate, standard error, and 95% CI.

| # | Statistic | Formula / method | Threshold that matters |
|---|---|---|---|
| ST1 | Cross-sectional rank IC per factor per horizon | `mean_t[ spearman_t(score, fwd_ret) ]` | IC ≥ 0.02 |
| ST2 | IC-IR | `mean(IC) / std(IC)` | ≥ 0.5 |
| ST3 | Newey-West t-stat on mean IC | lag = horizon − 1 | **≥ 3.0** (multiple-testing hurdle) |
| ST4 | Q10−Q1 spread, per horizon | decile means, net of costs | > 0 and monotone |
| ST5 | Block-bootstrap 95% CI on expectancy | stationary bootstrap, block ≈ 20d, 10k reps | **Does it exclude zero in either direction?** |
| ST6 | Block-bootstrap 95% CI on profit factor | same | Does it exclude 1.0? |
| ST7 | Effective sample size | `n / (1 + (c̄−1)·ρ̄)` | ESS vs nominal n |
| ST8 | Detectable effect size at 80% power | given ESS and observed variance | vs plausible true effect |
| ST9 | Mean pairwise cross-sectional return correlation `ρ̄` | daily, universe-wide | drives ST7 |
| ST10 | Deflated Sharpe Ratio | Bailey–López de Prado, using Q17 trial count | > 0 |
| ST11 | Factor correlation matrix eigenvalues | Spearman, cross-sectional | λ1/Σλ — effective rank |
| ST12 | MFE−realized gap | `mean(mfe21Pct − netRetPct)` and its distribution | large gap ⇒ H3 |
| ST13 | % trades where `mfe21Pct > 2×risk` but exit was stop-loss | direct count | how often stops cut eventual winners |
| ST14 | Turnover (annualized) | `Σ|Δweight| / 2` | cost realism |

**ST5 is non-negotiable.** If the 95% CI on expectancy is something like [−0.30, +0.22], then "the strategy has no edge" is not a statement the data supports — and neither is "the strategy has edge." That single interval determines whether *any* conclusion is currently licensed.

---

## 9. Required Experiments

In strict execution order. Each gates the next.

| # | Experiment | Method | Output | Gates |
|---|---|---|---|---|
| **E0** | **Price integrity audit** | §6 P1–P5; manually verify every P2 row against corporate actions | `price_audit.txt` | Everything |
| **E1** | **Estimator inspection** | Read C1; classify pooled vs cross-sectional | one-line answer | Interpretation of ρ≈0 |
| **E2** | **Study-method inspection** | Read C2, C3; classify B12/B13 method | one-line answer | Strength of existing evidence |
| **E3** | **Positive control** | 12-1 momentum + Piotroski F through (a) quantile harness, (b) full pipeline | CH12, `positive_control_*` | **Instrument validity (H2)** |
| **E4** | **Master quantile study** | Composite + 8 factors, deciles, forward returns, 6 horizons, no gates/exits/slots | CH1, CH2, ST1–ST4 | **H1** |
| **E5** | **MFE/MAE decomposition** | Add to TradeSimulator, re-run B9, analyze | CH3, CH4, ST12, ST13 | **H3** |
| **E6** | **Breadth experiment** | 2/20/50 slots, identical signals | CH6, `breadth_comparison.csv` | **H4** |
| **E7** | **Bootstrap CIs** | Stationary bootstrap on B9 ledger | ST5, ST6 | Whether any claim is licensed |
| **E8** | **Power analysis** | Given ESS + variance, detectable effect at 80% | ST7, ST8 | Whether studies could ever have succeeded |
| **E9** | **Distribution/degeneracy audit** | Factor panel histograms, clamp saturation, non-null rates | CH8–CH11, ST11 | H2 mechanisms |
| **E10** | **IC decay** | Rank IC across 10 horizons | CH5, ST1–ST3 | Horizon mismatch |
| **E11** | **Regime-conditional IC** | Split ST1 by regime | `ic_by_regime.csv` | Conditional signal |

**E0–E6 are Level 1. E7–E11 are Level 2.**

Total Level 1 effort: approximately **2–3 weeks** of focused work, all on existing data.

---

## 10. Decision Tree

```
═══════════════════════════════════════════════════════════════
GATE 0 — PRICE INTEGRITY (E0)
═══════════════════════════════════════════════════════════════
IF P2 returns unexplained extreme returns, OR P1 returns duplicates,
   OR stale-run counts are material, OR dividends are unadjusted
   → CONCLUSION 0: ALL RESULTS VOID (H5).
     Neither your conclusions nor my critique are supported.
     Action: rebuild the price layer against an authoritative
     corporate-action source, re-run every study. STOP HERE.

ELSE → proceed to Gate 1.

═══════════════════════════════════════════════════════════════
GATE 1 — ESTIMATOR VALIDITY (E1, E2)
═══════════════════════════════════════════════════════════════
IF ρ was computed as POOLED Spearman across all (stock,date) pairs
   → the "ρ≈0 for every factor" finding carries almost no information.
     My measurement critique stands. E4 is MANDATORY and exploratory.

IF ρ was computed as PER-DATE CROSS-SECTIONAL RANK IC with proper t-stats
   → the finding is real evidence for H1.
     My central critique weakens substantially. E4 becomes confirmatory.
     I would retract the "measurement artifact" framing.

IF B12/B13 used CROSS-SECTIONAL FORWARD-RETURN DECILES
   → those two negatives are methodologically sound and independent
     of the exit/portfolio problem. Existing evidence is stronger
     than I judged. My "six negatives are one negative" claim is
     partly WRONG and I retract it for those two.

IF B12/B13 routed through the trade simulator
   → they share the contaminated label. My claim stands for all six.

→ proceed to Gate 2 regardless.

═══════════════════════════════════════════════════════════════
GATE 2 — DOES THE SIGNAL CONTAIN INFORMATION? (E3, E4)  ★ MASTER GATE
═══════════════════════════════════════════════════════════════
FIRST check the positive control (E3):

  IF known anomaly (12-1 momentum / Piotroski) shows FLAT deciles
     in the quantile harness
     → CONCLUSION 1: THE INSTRUMENT IS BROKEN (H2).
       A decades-replicated anomaly cannot vanish in a correct harness.
       Every prior negative is uninformative.
       Action: debug the harness (label construction, date alignment,
       forward-return computation) before believing anything. STOP.

  IF known anomaly shows MONOTONE deciles with positive Q10−Q1
     → the harness works. Negatives are meaningful. Continue.

THEN check the composite and the 8 factors (E4):

  IF Q10−Q1 ≈ 0 and non-monotone at EVERY horizon, for the composite
     AND all 8 factors, AND ST5's bootstrap CI on expectancy is tight
     around zero
     → CONCLUSION 2: NO SIGNAL EXISTS (H1 CONFIRMED).
       The features contain no cross-sectional predictive information.
       Your conclusion is correct and was correctly reached.
       Exits and portfolio construction are irrelevant — there was
       nothing to destroy.
       Action: pivot to new information sources is scientifically justified.
       My review's central claim was WRONG and I retract it.

  IF Q10−Q1 ≈ 0 BUT ST5's CI is wide (e.g. spans [−0.3, +0.2])
     → CONCLUSION 3: UNDERPOWERED — NO CONCLUSION LICENSED.
       Neither "edge" nor "no edge" is supported by this data.
       Action: expand universe and/or lengthen sample before
       any pivot decision. The project cannot currently answer
       its own question.

  IF ANY factor (most likely SectorRelativeStrength) shows monotone
     deciles with Q10−Q1 > 0 and Newey-West t ≥ 3
     → SIGNAL EXISTS. Proceed to Gate 3 to locate where it died.

═══════════════════════════════════════════════════════════════
GATE 3 — WHERE WAS THE SIGNAL DESTROYED? (E5, E6)
═══════════════════════════════════════════════════════════════
(only reached if Gate 2 found signal)

CHECK A — exits (E5, CH3, ST12/ST13):
  IF mean(mfe21Pct) >> mean(netRetPct), and a large share of trades
     hit mfe21Pct > 2×risk yet exited via stop-loss
     → CONCLUSION 4: EXITS DESTROY THE EDGE (H3).
       The signal predicts; the stop policy harvests noise.
       Action: redesign exits (wider/vol-scaled stops, no fixed
       time-stop, horizon matched to IC decay from E10).

CHECK B — breadth (E6, CH6):
  IF 50-slot materially outperforms 2-slot on the same signal
     → CONCLUSION 5: PORTFOLIO CONSTRUCTION IS THE BOTTLENECK (H4).
       B11's conclusion is INVERTED. My claim confirmed.
       Action: rebuild portfolio construction before anything else.

  IF all three variants are equally poor
     → construction is NOT the bottleneck. B11 stands.
       Combined with a positive Gate 2, this points to costs or
       implementation rather than concentration.

CHECK A AND B BOTH POSITIVE:
  → CONCLUSION 6: SIGNAL EXISTS, DESTROYED BY BOTH LAYERS.
    The research methodology masked a real edge.
    Action: rebuild labels, exits and portfolio before ANY pivot.
    A pivot to new data would be premature and expensive.

═══════════════════════════════════════════════════════════════
GATE 4 — HORIZON (E10, only if Gate 2 positive)
═══════════════════════════════════════════════════════════════
IF IC peaks at h ≫ 7 days (e.g. 21 or 63)
   → CONCLUSION 7: HORIZON MISMATCH.
     You held a slow signal at fast-signal cost.
     Note: B14 tested longer *holding* under the same broken label
     and portfolio, so it did NOT test this.

IF IC peaks at h ≤ 5 days
   → the 7-day hold is roughly right; horizon is not the problem.
```

---

## Can I reach a final conclusion if every Level 1 question is answered?

**For four of your six target questions: yes, definitively.**

| Question | Resolvable with Level 1? |
|---|---|
| Does QuantSwing contain a genuine predictive signal? | ✅ **Yes** — E4 answers it directly, E3 validates the answer |
| Is the signal statistically insignificant? | ✅ **Yes** — ST5 bootstrap CI + ST8 power analysis |
| Is the research methodology masking an edge? | ✅ **Yes** — E1/E2/E3 answer this cleanly |
| Are the exits destroying profitable trades? | ✅ **Yes** — E5 (MFE) is dispositive |
| Is portfolio construction the bottleneck? | ✅ **Yes** — E6 is dispositive |
| **Should this pivot to entirely different alpha sources?** | ❌ **No — and this one is not resolvable by evidence at all** |

### The residual uncertainties, stated precisely

**1. The pivot question is not scientific.** Even a clean Gate-2 negative establishes only: *these 8 features, on these 166 names, over this 5.5-year window, at these horizons, contain no cross-sectional information.* It does not establish that no free-data edge exists in Indian equities. Generalizing from the former to the latter is an inductive leap that no experiment in this document licenses. The pivot decision is a judgment about opportunity cost, not a finding.

**2. The counterfactual of a fitted model remains untested.** A hand-weighted composite showing zero IC does not imply that a *fitted* combination of the same features has zero IC. Cross-sectional ridge on the same panel could recover signal that hand weights miss. Testing this requires actually fitting a model — which is research, not due diligence, and sits outside this document by construction.

**3. Regime coverage is irreducibly thin.** 5.5 years spans one cycle with no crisis. No experiment here can tell you how these signals behave in a 2008 or March-2020 regime. That uncertainty persists regardless of what the Level 1 evidence shows.

**4. Feature-space coverage.** "No signal in these 8 features" is a much narrower claim than "no signal in price data." Volume-profile, microstructure, seasonality, and cross-sectional-rank transforms of the *same* price series are untested. A negative verdict is a verdict on your feature set, not on your data.

**5. Non-stationarity cannot be fully resolved.** A signal that worked 2021–23 and decayed by 2025 averages to ≈0 IC. Rolling IC (Q23, Level 3) partially detects this, but distinguishing "decayed" from "never existed" over 5.5 years with one regime is genuinely underdetermined.

### The honest bottom line

Level 1 evidence will let me tell you, definitively, **whether your signal has information and where it died if it does.** It will not tell you whether to pivot — because that question depends on residuals 1, 2 and 4, and no amount of due diligence on existing data resolves them.

If you want the pivot question answered scientifically rather than by judgment, the minimum additional work is: fit a cross-sectional ridge on the existing panel (resolves #2), and expand the feature set with cross-sectional-rank and residualized transforms of data you already hold (resolves #4). Both are weeks, not months, and both precede any spend decision.

---

*Prepared against QuantSwing Master Reference (snapshot `93cbb86`), the prior Institutional Review, and the prior Due Diligence report. Every request is answerable from data currently held. No purchases required to reach a verdict.*
