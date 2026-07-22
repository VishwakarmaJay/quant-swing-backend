# QuantSwing — Research Due Diligence

**Purpose:** determine whether the project's conclusions are *justified by the evidence*, before approving any research budget or pivot. No recommendations. Evidence requests only.

---

## 0. First, an honest audit of my own review

I wrote a strong institutional review from documentation alone. Before requesting evidence from you, I should tier my own claims by how much they actually depend on artifacts I have never seen.

### Tier A — robust to missing evidence (derivable from stated design)

These are arithmetic or stated-fact. New artifacts cannot overturn them; they could only reveal the documentation was wrong.

| Claim | Basis |
|---|---|
| 2 concurrent positions → breadth ≈ 72 bets/yr → portfolio-level tests underpowered | Arithmetic from stated `maxOpenPositions=2`, 7-day hold |
| No factor risk model exists | Stated absence |
| Labels are path-dependent functions of exit rules | Stated design (SL/T1/T2/time-stop/thesis-break) |
| Returns measured in absolute, not residual, space | Stated design |
| The composite was never fit to a target variable | Stated design (hand weights + menu selection) |
| No multiple-testing correction, no DSR, no PBO | Stated absence |
| Long-only + beta-dominated market → returns are mostly beta | Structural |

### Tier B — plausible but evidence-dependent (I asserted these too strongly)

| Claim | What it actually needs |
|---|---|
| "The six negatives are not independent" | The actual study code + whether each shared the same label/estimator |
| "B11's conclusion is backwards" | The raw slot-allocation study output and its power characteristics |
| "ρ≈0 is an artifact of not fitting" | **The actual IC computation.** If they computed proper cross-sectional rank IC per date with Newey-West t-stats, ρ≈0 is a real finding and my critique weakens substantially |
| "Effective n ≪ nominal n invalidates the per-trade tests" | The trade-level panel, to compute actual concurrency and cross-sectional correlation |
| "Positive controls will fail" | **This is a prediction, not a finding.** Untested. |

### Tier C — my own error, corrected

> **My power argument applies much more strongly to portfolio-level conclusions than signal-level ones.** The signal-edge backtests ran *without* the 2-slot cap, on 981 and 4,394 trades. That is a materially better-powered design than I credited. Signal-level conclusions must be attacked on label contamination and effective sample size instead — both weaker arguments than the breadth arithmetic. I conflated two arguments of unequal strength and presented them as one.

**Net:** roughly 60% of my review is Tier A and stands. Roughly 40% is Tier B and I should not have stated it with the confidence I did. This DD is designed to resolve Tier B.

---

## 1. Raw Data

### 1.1 OHLCV panel

**Request:** full `ohlcv` export — `instrumentId, symbol, tradeDate, open, high, low, close, volume`, plus `instrument` join giving `sector, instrumentType, isin, listingDate, delistDate`.

- **Why it matters:** every downstream number rests on this. Silent price errors (unadjusted splits, stale republications) propagate into every factor and every conclusion. You already found *two* such bugs (the `PREV_CLOSE/OPEN` split miss; the duplicate-row republication artifact). Two found implies more unfound.
- **Decision affected:** whether *any* backtest result is trustworthy.
- **How to analyze:** distribution of daily returns per name; count |return| > 20% and manually verify each against corporate-action records; check for duplicate `(symbol, date)`; check for gaps vs NSE trading calendar; verify Angel-adjusted series against bhavcopy raw + corporate actions for 20 random names; check volume zeros and stale-price runs (`close[t] == close[t-1]` for 3+ days).
- **Good evidence:** < 0.1% of daily returns exceed ±20% and each is explained by a real event; zero duplicate keys; gaps match the exchange holiday calendar exactly; independent reconstruction from bhavcopy matches Angel to within rounding.
- **Bad evidence:** unexplained jumps; a systematic pattern of large moves clustered on particular dates (republication artifacts); mismatch between the two sources for the same name/date.
- **Could it change conclusions?** **Yes, completely.** Undetected adjustment errors create fake volatility that stops you out of winners. Given `mult × ATR` stops, corrupted ATR directly manufactures the "trims left tail, no winners" signature you observed. **This is my #1 suspect for a mechanical explanation of your results.**

### 1.2 Corporate actions

**Request:** the full corporate-action table used for adjustment — `symbol, exDate, actionType (split/bonus/dividend/demerger/rights), ratio, source`. If none exists as a first-class table, say so explicitly.

- **Why it matters:** your docs describe split adjustment as a *heuristic inferred from price discontinuities*, not as a join against an authoritative action list. Heuristic adjustment on gappy data is exactly where silent corruption lives — and your own `SURVIVORSHIP.md` documents the heuristic misfiring (PEL's spurious −83% day).
- **Decision affected:** trustworthiness of every price-derived factor.
- **Good evidence:** an authoritative corporate-action table joined by `(symbol, exDate)`, with reconciliation showing every large price gap is either explained by an action or verified as a genuine move.
- **Bad evidence:** "we infer it from `PREV_CLOSE/OPEN`." That is a fallback, not a source of truth.
- **Could it change conclusions?** **Yes.** Especially for dividends — if dividends are not adjusted, every high-yield name carries systematic negative drift on ex-dates, which biases against value/quality names.

### 1.3 News archive

**Request:** `news_article` export (schema + 10k-row sample + full aggregate stats): `id, source, url, title, symbols[], aliasVersion, publishedAt, fetchedAt, availableAt, origin, sentimentScore, sentimentLabel, posProb, negProb, neutralProb, sentimentModel, sentimentScoredAt`.

Plus: **articles-per-symbol-per-day histogram**, split by `origin`, over the full archive.

- **Why it matters:** the sentiment factor's usability depends entirely on coverage density. `minArticles = 3` in a 30-day window means a name with < 3 articles/month returns neutral-50 and the factor is inert. If the median universe name has 1–2 articles/month, **the sentiment factor was never actually active for most of the universe** — meaning B7 measured almost nothing, and the `sentimentFactorFloor:50` "strongest lever" result may be driven by a handful of heavily-covered names.
- **Decision affected:** whether B7 and B9's floor gates mean anything; whether the archive can support the Jan-2027 revisit plan.
- **How to analyze:** per-symbol per-month article counts; % of `(symbol, date)` cells where the aggregate returns non-null; distribution of Σw (the weight sum); coverage by `origin` tier over time.
- **Good evidence:** ≥ 80% of universe-days have ≥ 3 articles in the trailing 30 days, with reasonable spread across names.
- **Bad evidence:** coverage concentrated in the top 20 names; median name inert; `origin=LIVE_*` coverage only starting 2026-07 (which would mean the "coverage era" is really only GDELT-reconstructed data).
- **Could it change conclusions?** **Yes.** If coverage is thin, B7's positive result is a small-sample artifact from a handful of names, and the whole "wait until Jan 2027" strategy needs re-planning.

### 1.4 Fundamentals

**Request:** `quarterly_fundamental` and `fundamental_snapshot` exports: `symbol, fiscalPeriod, periodEnd, announcedAt, availableAt, fallbackAvailableAt, eps, netProfit, sales, source, ingestedAt` + whether restatements are versioned or overwritten.

- **Why it matters:** two distinct risks. (a) **Restatement lookahead** — if a later restatement overwrites the original figure, your "point-in-time" fundamental is contaminated with information that didn't exist. (b) **`fallbackAvailableAt` share** — if a large fraction of quarters use the SEBI-deadline fallback rather than a real `announcedAt`, the PIT guarantee is much weaker than documented.
- **Decision affected:** validity of B5 and the `fundamentalFloor:50` gate in the production config.
- **How to analyze:** count rows where `announcedAt IS NULL` (fallback used); check for any `UPDATE` history on the table; distribution of `announcedAt − periodEnd` (should cluster 30–75 days; values < 20 days are suspicious); coverage per symbol per quarter.
- **Good evidence:** > 90% real `announcedAt`; append-only with restatements as new rows carrying their own `availableAt`; lag distribution plausible.
- **Bad evidence:** heavy fallback reliance; overwrite-on-restate; missing quarters concentrated in specific sectors or periods.
- **Could it change conclusions?** **Yes** for B5/B9 specifically. Restatement lookahead would make the fundamental floor look better than it is.

### 1.5 Options chain — **not currently held, request confirmation**

Confirm you have **no** options data. If any exists: `symbol, expiry, strike, optionType, date, settlementPrice, IV, openInterest, changeInOI, volume, underlyingClose`.

- **Why it matters:** determines whether §11's options ideas (IV skew, VRP, PCP deviation) are a data-acquisition project or an analysis project.
- **Could it change conclusions?** Not about past results — but it changes the "free avenues exhausted" claim materially.

### 1.6 FII/DII, participant OI, pledge, bulk deals — **confirm absence**

Confirm none of these are held. Their absence is the load-bearing fact behind my "free avenues not exhausted" claim, and I should verify it rather than assume it from the docs.

### 1.7 Consensus estimates — **confirm absence**

Confirmed absent per `OPTION_C_ESTIMATES.md`. No request.

---

## 2. Feature Store

**There is no feature store.** So the request is: **build a one-off feature panel export** from a single backtest replay.

**Request format:** `(date, symbol, factorName, score, agreementContribution, <all raw metrics>)` for every universe-day over the full 5.5 years — the raw `FeatureBundle` contents, not just the 0–100 scores.

**Critically: I need the pre-clamp raw values** (raw excess return before `clamp(excess/20,±1)`, raw ATR%, raw RSI, raw P/E percentile, raw sentiment mean), not just the mapped scores.

| Item | Why it matters | Good evidence | Bad evidence | Changes conclusions? |
|---|---|---|---|---|
| **Daily factor values** | Everything else is computed from these | Complete panel, < 5% missing | Large missing blocks, especially early period | Yes — missingness patterns can create fake results |
| **Distributions per factor** | Detect degenerate factors | Reasonable spread; Trend takes all 5 discrete values with meaningful mass | **Trend is 5-valued (0/25/50/75/100) — if 60%+ of observations sit at one value, it carries almost no cross-sectional information.** I strongly suspect this. | **Yes, materially** |
| **Missing-value rates** | Neutral-50 imputation is not neutral | Sentiment/Fundamental non-null on > 70% of universe-days | If Sentiment is null on 90% of days, B7 measured a tiny subsample | **Yes** |
| **Cross-factor correlation matrix** | Effective rank of the composite | Pairwise ρ < 0.5 across the four technical factors | ρ(Trend, Momentum) > 0.7 and ρ(Trend, RS) > 0.6 → effective rank ≈ 1.5, "4-factor composite" is really a 1-factor composite | **Yes** — would confirm the diversification is illusory |
| **Stability over time** | Regime dependence, drift | Rolling 6-month factor means and stds are stable | Level shifts at data-source changes (e.g. Moneycontrol→Livemint switch) | Yes for sentiment specifically |
| **Feature drift** | Non-stationarity | Distributions comparable across 2021 vs 2025 | Systematic drift → walk-forward folds aren't comparable | Yes |
| **Factor decay (autocorrelation)** | Turnover implications, and whether a 7-day horizon matches the signal's natural half-life | Factor autocorrelation half-life ≈ or > holding period | If a factor's half-life is 60 days but you hold 7, you're churning a slow signal at fast-signal cost | **Yes** — could reframe the horizon question entirely |

**Why the pre-clamp values matter so much:** if `clamp` is saturating (e.g., 40% of RS observations hit ±1), then the factor is effectively a 3-state variable and the clamping is destroying most of the cross-sectional information. This is directly testable and would be a smoking gun.

---

## 3. Labels

**Current label:** per-trade net % return after path-dependent exits. **I need alternatives computed on the same signal set** so the label's effect can be isolated.

| Label | Necessary? | Why |
|---|---|---|
| **Forward raw return** at h ∈ {1,3,5,10,21,63} | **Critical** | The baseline. Without it you cannot separate "signal has no information" from "exits destroyed the information." |
| **Forward market-excess return** (`r_stock − r_nifty`) | **Critical** | First-order beta removal. Cheap, immediate. |
| **Forward residual return** (vs market+sector, or a 4-factor model) | **Critical** | The correct research object. Your own horizon study's "the tail is beta" finding is unresolvable without this. |
| **Cross-sectionally demeaned return** (`r_i − mean(r_all)` per date) | **Critical** | Makes observations closer to independent; directly addresses the effective-sample-size problem. |
| **MFE (max favourable excursion)** | **High** | **This is the single most diagnostic label for your specific finding.** If MFE is large but realized return is small, your *exits* are destroying edge. If MFE is also small, the signal genuinely has no information. This one number discriminates between the two competing explanations of everything. |
| **MAE (max adverse excursion)** | **High** | Tells you whether stops are set inside the noise. If median MAE at the stop level is high, you're being stopped out by noise before the thesis plays out. |
| **Quantile / decile labels** | **High** | Needed for quantile-spread analysis (Q1 vs Q10) — the standard factor-evaluation output you've never produced. |
| **Ranking labels** | **Medium** | Needed for LTR later; not needed for DD. |
| **Vol-scaled returns** (`r / σ`) | **Medium** | Prevents high-vol names dominating the label. |

**The MFE/MAE request is the highest-information single item in this entire document.** It is computable from data you already have, in a day, and it directly tests my core Tier-B claim.

---

## 4. Backtests

**Request the raw artifacts, not the summary docs.**

| Artifact | Why | Good evidence | Bad evidence | Changes conclusions? |
|---|---|---|---|---|
| **Full trade-level ledger** — every trade, every study: `symbol, signalDate, entryDate, entryPx, exitDate, exitPx, exitReason, grossRet, netRet, costs, regime, composite, all factor scores, holdingDays` | Everything else is aggregation. I can recompute all your statistics and check them. | Reproduces the reported headline numbers exactly | Cannot reproduce reported numbers → a reporting or aggregation bug | **Yes, decisively** |
| **Equity curves** (per study, daily) | MDD, path dependence, regime attribution | Smooth-ish, losses distributed across time | Losses concentrated in a few windows → the "no edge" conclusion is really "one bad regime" | **Yes** |
| **Rank IC per date** + IC-IR | **The single most important missing output.** You report Spearman ρ ≈ 0 but I don't know if that's *pooled* ρ (wrong) or *per-date cross-sectional* rank IC averaged (right). | Mean rank IC with Newey-West t-stat, per factor, per horizon | If ρ was computed pooled across all (stock,date) observations, **the number is close to meaningless** — it's dominated by cross-sectional variance in the market factor, not by predictive content | **Yes — this is the crux of my Tier-B disagreement** |
| **IC decay curve** (IC vs horizon 1→63d) | Reveals the signal's natural horizon | Monotone decay from a positive peak | Flat at zero everywhere → genuinely no information at any horizon | **Yes** |
| **Quantile spread returns** (Q1–Q10 by composite, per date) | The standard factor test you never ran | Monotone quantile ordering, Q10−Q1 > 0 | Non-monotone/flat → confirms no ranking information | **Yes** |
| **Turnover stats** | Cost realism | Reported and priced | Not measured | Medium |
| **Exposure/concurrency time series** | How many positions actually held, when | Confirms effective breadth | If typically 0–1 positions, breadth is even worse than 2 | **Yes — worsens my power argument** |
| **Hit rate by decile** | Precision vs recall structure | — | — | Medium |
| **Sharpe, Sortino, DSR, PBO** | Multiple-testing honesty | DSR computed with honest trial count | Absent (currently) | **Yes** |
| **Trial counter** — total number of configs/variants ever evaluated | Denominator for DSR | An honest number, even if it's 200 | "We don't know" → then no OOS number can be trusted | **Yes** |

---

## 5. Statistical Validation

Tests I would require before believing *any* result, positive or negative.

| Test | What it answers | Applied to | Good | Bad |
|---|---|---|---|---|
| **Block bootstrap CI** (stationary/circular, block ≈ 20d) on expectancy, PF, Sharpe | Is "−0.04%/trade" distinguishable from zero — or from +0.10%? | Every headline number | Tight CI excluding zero (either sign) | **CI spanning [−0.3, +0.2] → the "no edge" conclusion is unsupported; you may have positive edge** |
| **Permutation / label-shuffle test** | Null distribution under no predictive relationship | Every factor, composite | Observed IC outside the 95th pct of shuffled | Observed IC sits inside the null → confirms no information |
| **Multiple-testing correction** (Benjamini-Hochberg for FDR; Harvey-Liu-Zhu t>3.0 hurdle) | Which results survive the trial count | All reported findings | Findings survive at FDR 10% | Nothing survives → all "findings" are noise, in both directions |
| **Effective sample size** — average pairwise correlation of daily cross-sectional returns; concurrency-adjusted n | Are 4,394 trades really 4,394 observations? | Per-trade studies | ESS within 3× of nominal | **ESS < 10% of nominal → all t-stats overstated by 3×+** |
| **Power analysis** | Given design + n, what effect size was detectable at 80% power? | Every study | Detectable effect < plausible true effect | **Detectable effect > plausible true effect → the study could never have succeeded, and its negative result is uninformative** |
| **Regime stability** — IC by regime, by year, by vol tercile | Is a null an average of + and −? | All factors | Consistent sign | Sign flips across regimes → "no edge" is really "unconditional edge is zero, conditional edge exists" |
| **Rolling IC** (6/12m windows) | Decay vs instability | All factors | Stable or slowly decaying | Wild oscillation → non-stationary, needs regime conditioning |
| **Factor persistence** — autocorrelation of factor ranks | Turnover + horizon match | All factors | Half-life ≳ holding period | Half-life ≪ holding period → you hold past the signal's life |
| **White's Reality Check / Hansen SPA** | Does the best config beat the best-of-noise? | The 8-config walk-forward | Winner beats SPA null | Fails → "selected on all 4 folds" is meaningless |
| **Deflated Sharpe Ratio** | Trial-count-adjusted | Every reported Sharpe | DSR > 0 | DSR ≪ 0 |
| **PBO via CSCV** | Overfit probability | The config selection | PBO < 0.3 | PBO > 0.5 → selection is noise-fitting |

**The two I would run first:** bootstrap CIs on the headline expectancy (one day of work — tells you whether "no edge" is even a supportable statement), and the power analysis (half a day — tells you whether any of it was ever detectable).

---

## 6. Factor Validation

For each factor, the evidence that would convince me it has predictive power. Same standard applied uniformly.

**Universal bar (all must hold):**
1. Mean cross-sectional **rank IC ≥ 0.02**, Newey-West t ≥ **3.0** (not 2.0 — multiple-testing hurdle)
2. **Monotone quantile spread**, Q10−Q1 positive and significant, net of costs
3. **IC sign stable** across ≥ 70% of rolling 12-month windows
4. **Survives residualization** against market, size, sector, and the other factors — i.e. incremental IC in a multivariate Fama-MacBeth, not just univariate
5. **Survives permutation test** at 95%
6. **Positive on out-of-sample folds** with PBO < 0.3

**Factor-specific concerns:**

| Factor | Specific evidence needed | My prior |
|---|---|---|
| **Trend** | Distribution across its 5 discrete values. If mass concentrates at 100 (common in a bull market), it has near-zero cross-sectional discrimination. | Likely degenerate |
| **Momentum** | Decomposed IC for the MACD component vs the RSI component separately — they may have opposite signs and cancel | Suspect cancellation |
| **RelativeStrength** | % of observations hitting the ±20% clamp; IC on raw excess vs clamped score | Clamp likely saturating |
| **SectorRelativeStrength** | **Highest priority.** It's your only cross-sectional factor and your only factor that helped. I want its standalone rank IC, quantile spread, and IC decay. | **Most likely to have real IC** |
| **Volume** | Confirm it's genuinely harmful vs merely noisy — LOO attribution with CI | Likely just noise |
| **Volatility** | Not directional; validate its use in sizing instead — does ATR-based sizing improve risk-adjusted return vs equal-weight? | Untested as used |
| **Fundamental** | Value and growth components separately; % of observations where growth drops out; P/E peer-count distribution | Value component may work |
| **Sentiment** | Non-null rate; IC computed *only on non-null observations* (not diluted by neutral-50 imputation); level vs abnormal-tone comparison | Diluted to death by imputation |

**The neutral-50 imputation issue deserves emphasis:** if Sentiment is null on 80% of observations and imputed to 50, then a pooled IC on the full panel is ~80% noise by construction. The factor could have strong IC on its non-null subset and show ≈0 overall. **This is a concrete, testable mechanism by which a real signal would look dead in your framework.**

---

## 7. Portfolio Construction — which layer is the bottleneck?

To decide between *signal quality*, *portfolio construction*, and *execution*, I need three decompositions:

**A. Signal quality, portfolio-free**
Quantile spread returns on the full universe, equal-weighted, no gates, no stops, no slots, no costs. Pure ranking test.
- Q10−Q1 > 0 significantly → **the signal has information; the portfolio is destroying it**
- Q10−Q1 ≈ 0 → signal genuinely has no ranking content

**B. Portfolio construction cost**
Same signal, three portfolios: (i) 2 slots as-built, (ii) top-20 equal-weight, (iii) top-50 equal-weight. Same period, same costs.
- If (iii) ≫ (i) → **construction is the bottleneck**, and B11's conclusion is wrong
- If all ≈ equally bad → signal is the bottleneck, B11 stands

**C. Execution/exit cost**
Compare realized per-trade return vs (a) buy-and-hold-for-h-days on the same signals, (b) MFE.
- If hold-h ≫ realized → **exits are the bottleneck**
- If MFE ≫ realized ≫ hold-h → stops are cutting winners

**These three experiments are cheap** — all reuse the existing signal set — and they definitively assign blame. **Until they're run, "the bottleneck is signal quality" is an assertion, not a finding.** This is the most consequential unresolved question in the project.

---

## 8. Machine Learning — evidence before believing ML helps

I would refuse to approve an ML budget without:

1. **Linear baseline first.** Cross-sectional ridge / Fama-MacBeth on the same features and labels. If linear IC ≈ 0, GBDT will overfit, not discover. **No ML until the linear baseline is measured.**
2. **Feature IC table.** If no individual feature has IC > 0.01, there is likely nothing for a model to combine.
3. **Purged-CV infrastructure demonstrated working** on a synthetic dataset with known signal, before use on real data.
4. **Learning-curve analysis** — does performance improve with more data? If flat, you're data-limited and ML won't help.
5. **Sample-size sanity:** ~166 names × ~1,375 days ≈ 228k rows, but ESS is far lower due to cross-sectional correlation. With 8 features that's fine for ridge; with 300 features and GBDT it's marginal.
6. **Ablation:** GBDT vs ridge vs the existing rubric, all under identical purged CV.

**Good evidence ML is warranted:** linear IC positive but modest, individual features show nonlinear/interaction structure in partial-dependence plots, learning curve still rising.
**Bad evidence:** linear IC ≈ 0 and someone proposes deep learning anyway.

---

## 9. Data Quality Audit Checklist

**Price data**
- [ ] Duplicate `(symbol, tradeDate)` count
- [ ] Gaps vs NSE trading calendar
- [ ] OHLC internal consistency violations (`high < max(o,c)`, etc.) — count, not just the filter's rejection rate
- [ ] Zero/negative prices and volumes
- [ ] Stale price runs (identical closes ≥ 3 days)
- [ ] |return| > 20% events — every one explained
- [ ] Split/bonus adjustment verified against an authoritative action list for ≥ 20 names
- [ ] Dividend adjustment — is it done at all?
- [ ] Cross-vendor reconciliation (Angel vs bhavcopy) on a random sample
- [ ] Republication/stale-file detection across the full bhavcopy archive (you found one — how many more?)
- [ ] `DataQualityService` rejection rate over time — a rising rate signals feed degradation

**News**
- [ ] Coverage per symbol per month (median, p10, p90)
- [ ] `availableAt` monotonicity vs `fetchedAt`
- [ ] `availableAt < publishedAt` violations (should be zero)
- [ ] Symbol-tag precision audit on a fresh random 200-article sample, by `origin`
- [ ] Duplicate detection false-positive/negative rate on a labelled sample
- [ ] Sentiment score distribution — is it bimodal, degenerate, or reasonable?
- [ ] % of articles unscored
- [ ] Coverage discontinuities at source changes (Moneycontrol → Livemint)

**Fundamentals**
- [ ] `announcedAt` null rate (fallback usage)
- [ ] `announcedAt − periodEnd` distribution
- [ ] Restatement handling — append vs overwrite
- [ ] Coverage per symbol per quarter
- [ ] EPS sign/magnitude outliers

**Universe**
- [ ] PIT membership completeness
- [ ] Delisted-name coverage vs the true dead-name population 2021–2026
- [ ] Sector-assignment stability over time (NSE taxonomy drifts — you noted this for midcaps)

---

## 10. Research Process

### Was the scientific method followed?

**Partially.** Strong on falsification-willingness and reproducibility, weak on experimental design.

| Element | Status |
|---|---|
| Pre-registered hypotheses | ❌ Absent |
| Stated economic mechanism per hypothesis | ❌ Absent (except Option C) |
| **Positive controls** | ❌ **Absent — the largest process gap** |
| Negative controls | ⚠️ Partial (B11's seeded random control is a good instance) |
| Power analysis before running | ❌ Absent |
| Trial counting | ❌ Absent |
| Pre-specified success criteria | ⚠️ Partial ("beat Nifty risk-adjusted OOS" is stated but not operationalized with a t-stat) |
| Independent replication | ❌ Absent |
| Falsification willingness | ✅ **Excellent** — best-in-class |
| Reproducibility | ✅ Excellent |

### Missing experiments (in priority order)

1. **Positive control** — known anomaly through the existing pipeline. *Determines whether the instrument works.*
2. **MFE/MAE decomposition** — *determines whether exits or signal is the problem.*
3. **Portfolio-free quantile test** — *determines whether construction or signal is the problem.*
4. **Proper cross-sectional rank IC** — *determines whether ρ≈0 was measured correctly.*
5. **Bootstrap CIs on headline numbers** — *determines whether "no edge" is even sayable.*
6. **Power analysis** — *determines whether any study could have succeeded.*
7. **Neutral-50 dilution test** — IC on non-null sentiment subset only.
8. **Clamp-saturation test** — raw vs clamped feature IC.
9. **Factor collinearity/effective-rank analysis.**
10. **Regime-conditional IC** — is the unconditional null hiding conditional signal?

**Every one of these uses data you already have.** None requires a purchase. Total effort: roughly 3–4 weeks.

---

## 11. Hidden Assumptions

| # | Assumption | How it could invalidate conclusions |
|---|---|---|
| 1 | Price data is correct | Bad adjustments manufacture the exact "stopped out of winners" pattern observed. **Highest-risk assumption.** |
| 2 | Per-trade expectancy measures predictive power | It measures signal ∘ exits. A good signal with bad exits is indistinguishable from no signal. |
| 3 | ρ≈0 was computed as cross-sectional rank IC | If pooled, the number is near-meaningless and the central finding evaporates. |
| 4 | 2 positions is a valid test bed for signal quality | It has no power to distinguish rankings. B11's conclusion likely inverted. |
| 5 | Neutral-50 imputation is "neutral" | It dilutes a possibly-real signal toward zero proportional to missingness. |
| 6 | Clamping preserves information | It destroys tail information, which is where signal concentrates. |
| 7 | The four technical factors are diversifying | Likely effective rank ≈ 1.5 — one factor wearing four hats. |
| 8 | Walk-forward selection among 8 configs is out-of-sample | It's a max-statistic over 8 correlated candidates; upward-biased. |
| 9 | The six negatives are independent | They share label, portfolio, and estimator. Possibly one negative counted six times. |
| 10 | 5.5 years is sufficient | One market cycle. No prolonged bear, no crisis regime. |
| 11 | Absolute returns are the right space | Beta swamps alpha; your own horizon study found this and didn't act on it. |
| 12 | Costs are 0.25% round-trip regardless of size | No impact model; also wrong at small notional where fixed DP charges dominate. |
| 13 | Free data is exhausted | 11 untouched India-specific free datasets contradict this. |
| 14 | The midcap spike tested midcap alpha | It tested transfer of a large-cap-tuned config. Different hypothesis. |
| 15 | FinBERT headline sentiment is a usable signal | Trained on US text; measures level not surprise; headline-only. |
| 16 | The nightly universe is stationary | Sector taxonomy drifts; constituents change. |
| 17 | The `−6.5%` and `−17.08%` COVERAGE figures describe the same thing | If they don't, one is wrong, and the decisive gate is unresolved. |

---

## 12. Confidence Assessment

My honest posterior on each conclusion — mine and yours — given documentation only.

### Your conclusions

| Conclusion | Confidence it's **correct** | Evidence available | Evidence missing | Most efficient test |
|---|---|---|---|---|
| "The strategy as-built does not beat Nifty" | **90%** | Multiple portfolio backtests, consistent direction | The −6.5%/−17.08% reconciliation | Reconcile the two runs |
| "The strategy has no exploitable edge **as a portfolio**" | **80%** | Portfolio sims across windows | CIs; the design had no power anyway | Bootstrap CI + power analysis |
| "The **signal** has no predictive information" | **45%** | Per-trade tests, ρ≈0 | **Proper cross-sectional IC; MFE; portfolio-free quantile test** | Quantile spread test (§7A) |
| "Every lever trims left tail, none finds winners" | **65%** | Consistent across 6 studies | MFE data — this pattern is *also* the signature of stops cutting winners | **MFE/MAE decomposition** |
| "The bottleneck is signal quality, not allocation" (B11) | **35%** | Slot study vs random control | Power characteristics of a 2-slot test | §7B three-portfolio comparison |
| "Free-data avenues are exhausted" | **15%** | Six studies | Confirmation that 11 free datasets are genuinely unheld | Confirm §1.5–1.6 |
| "Mid/small-cap offers no improvement" | **50%** | Midcap spike | A midcap-native config fit, not transferred | Refit on midcaps |
| "Survivorship is not masking an edge" | **85%** | Well-executed repair | Only 10 dead names ingested | Expand dead-name cohort |
| "PEAD is the highest-odds remaining lever" | **70%** | B12 + strong literature | Whether cheaper free proxies (time-series SUE) work first | Build free SUE |

### My conclusions

| My claim | Confidence | What would change it |
|---|---|---|
| Portfolio design was underpowered (2 slots) | **95%** | Only if `maxOpenPositions` isn't what the docs say |
| Label is exit-contaminated | **92%** | Nothing — it's a design fact |
| Absolute-vs-residual space is a real defect | **90%** | Nothing |
| Composite was never fit to a target | **95%** | Nothing |
| No multiple-testing correction applied | **90%** | Evidence it was done and undocumented |
| The six negatives are non-independent | **75%** | Study code showing genuinely different estimators |
| **B11's conclusion is backwards** | **65%** | §7B result |
| **ρ≈0 is a measurement artifact** | **50%** | **The actual IC computation code — this is my least-supported strong claim** |
| **Positive controls will fail** | **55%** | Running them. This is a *prediction*, and I flagged it too confidently in the review. |
| Free avenues not exhausted | **85%** | Confirmation the datasets are genuinely unheld |
| Engineering quality is excellent | **90%** | Code review |

---

## Prioritized Due Diligence Roadmap

### CRITICAL — no conclusion is safe until these are done

| # | Item | Time | Difficulty | Information gain |
|---|---|---|---|---|
| 1 | **Reconcile −6.5% vs −17.08%** | 0.5d | Low | **Very high** — one is wrong |
| 2 | **Positive control** (12-1 momentum, F-score through existing pipeline) | 3–5d | Low-med | **Highest of anything here** — validates or invalidates the instrument |
| 3 | **How was ρ computed?** Pooled or per-date cross-sectional rank IC? | 0.5d | Trivial | **Very high** — decides my central Tier-B claim |
| 4 | **MFE/MAE per trade** | 1–2d | Low | **Very high** — separates "no signal" from "bad exits" |
| 5 | **Bootstrap CIs on all headline numbers** | 1d | Low | Very high — is "no edge" even a supportable statement? |
| 6 | **Power analysis** per study | 1d | Low-med | Very high — could retroactively void every negative |
| 7 | **Price data audit** (§9 price block) | 2–3d | Med | **Very high** — you've already found 2 bugs |
| 8 | **Trial count** for DSR | 0.5d | Low | High |

**Critical block total: ~2 weeks.** After this, we know whether *anything* in the research program means what it claims.

### HIGH PRIORITY

| # | Item | Time | Difficulty | Gain |
|---|---|---|---|---|
| 9 | Portfolio-free quantile spread test (§7A) | 2–3d | Med | Very high |
| 10 | Three-portfolio comparison 2/20/50 (§7B) | 2–3d | Med | Very high — settles B11 |
| 11 | Exit-cost decomposition (§7C) | 2d | Low-med | High |
| 12 | Feature panel export + distributions + correlations | 3–4d | Med | High |
| 13 | Neutral-50 dilution test (IC on non-null only) | 1d | Low | High |
| 14 | Clamp-saturation test (raw vs clamped IC) | 1d | Low | High |
| 15 | Effective sample size computation | 1–2d | Med | High |
| 16 | News coverage density analysis | 1d | Low | High — decides if B7 means anything |
| 17 | Fundamentals restatement/fallback audit | 1–2d | Low | Med-high |

### MEDIUM PRIORITY

| # | Item | Time | Gain |
|---|---|---|---|
| 18 | Rolling IC + regime-conditional IC | 2–3d | Med-high |
| 19 | Factor autocorrelation / decay half-life | 1d | Med-high |
| 20 | Permutation tests per factor | 2d | Med |
| 21 | PBO via CSCV on config selection | 3d | Med |
| 22 | Corporate action authoritative-source reconciliation | 3–5d | Med |
| 23 | Symbol-tag precision re-audit | 1–2d | Med |
| 24 | Confirm absence of the 11 free datasets | 0.5d | Med |

### NICE TO HAVE

| # | Item | Time |
|---|---|---|
| 25 | White's Reality Check / Hansen SPA | 2–3d |
| 26 | Expand dead-name cohort beyond 10 | 3–5d |
| 27 | Cross-vendor price reconciliation at scale | 3d |
| 28 | Independent replication of one study by a second implementation | 5d |

---

## Final Question

> **"If I gave you all of the requested evidence, would you expect your current opinion of QuantSwing to change?"**

**Yes — substantially, and in both directions. I would expect roughly a third of my review to move.**

### Most likely to change

**1. "The signal has no predictive information" (my 45% → could go to 10% or 85%)**
This is the conclusion most exposed to evidence. Four artifacts move it hard: proper cross-sectional rank IC, MFE data, the portfolio-free quantile test, and the neutral-50 dilution test. If SectorRelativeStrength shows standalone rank IC ≈ 0.03 with a monotone quantile spread, then **you have a real factor and the entire "no edge" narrative is wrong** — you had a signal and a portfolio too concentrated to express it.

**2. "B11 proved allocation isn't the bottleneck" (my 65% it's backwards)**
The three-portfolio test settles this in days. I think it flips.

**3. My own "positive controls will fail" prediction (55%)**
Genuinely uncertain, and I over-projected confidence in the review. If momentum and F-score come through your pipeline with clean positive IC, **my central thesis is wrong**, your instrument works, and your six negatives are real findings about your factors rather than artifacts of measurement. I'd retract the review's framing and the correct conclusion would become: *the platform is sound, the features are exhausted, and the answer really is new data.*

**4. Price data quality (could invalidate everything)**
If the audit finds systematic adjustment errors, every conclusion in the project — yours and mine — is void, and the correct action is to rebuild the price layer and re-run everything. Given two bugs already found in this area, I put this at maybe 25–30%.

### Least likely to change

- Engineering and reproducibility quality (excellent, verified by documentation of practices that are hard to fake)
- The absence of a risk model (a stated fact)
- The label-contamination critique (a design fact)
- The breadth arithmetic for portfolio-level conclusions (arithmetic)
- "Free avenues are exhausted" being wrong (I'd need to be shown the datasets are held)

### The asymmetry worth noticing

**Every one of the eight Critical items uses data you already have and costs nothing but time.** Two weeks of work would tell you whether six months of research means what you think it means. That is an extraordinarily good trade, and it should happen before any spend decision on Option C, any pivot, and any new strategy work.

**My honest position:** I gave you a confident review, and roughly 40% of it rests on inferences I cannot verify from documentation. The Critical block resolves nearly all of that. Until it's run, neither of us should be as confident as we've both been sounding — you about the absence of edge, me about the absence of measurement.

---

*Due diligence conducted against QuantSwing Master Reference (repo snapshot `93cbb86`) and the prior institutional review. No raw research artifacts were available at time of writing — which is precisely the point of this document.*
