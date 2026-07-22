# QuantSwing — Final Verdict

**Investment Committee / Academic Referee position. $10M research budget decision.**

---

## Task 0 — Correcting the premise

The brief states ~10–20% uncertainty remains. **That estimate is not supportable, and the error matters.**

Across three reviews I have received: **zero trade ledgers, zero source files, zero SQL output, zero charts, zero raw backtest logs.** Every assessment — mine of your project, and yours of your own results — rests on prose documentation authored by the same party whose conclusions are under review.

This does not mean the documentation is wrong. The internal consistency, the self-retractions, and the specificity of the bug reports (`PREV_CLOSE/OPEN`, the RELINFRA index-exit trap, the duplicate-republication artifact) are strong indirect evidence of competence and honesty. But **indirect evidence of honesty is not evidence of correctness**, and no amount of well-written documentation substitutes for one CSV.

The uncertainty is therefore **bimodal, not 10–20%**:

| Class | Uncertainty | Why |
|---|---|---|
| **Design facts** (slot count, label construction, absence of risk model, hand-set weights) | **~2%** | Derivable arithmetic from stated configuration. Only overturnable if the documentation misdescribes the implementation. |
| **Empirical facts** (does any factor carry cross-sectional information) | **~50%** | Never measured, by either of us. No artifact exists. |

A single averaged "15%" conceals the only distinction that matters.

---

## Task 1 — Self-falsification of every conclusion I hold

| # | Conclusion | Supporting evidence | Contradicting evidence | Hidden assumption | Single overturning artifact | Status |
|---|---|---|---|---|---|---|
| **C1** | Portfolio breadth ≈ 72 bets/yr → portfolio-level inference is underpowered | Arithmetic on `maxOpenPositions=2`, 7-day hold | None available | Documented config = executed config; realized concurrency ≈ 2 | `concurrency.csv` showing sustained concurrency ≫ 2, or a config showing different values | **Established** *(conditional on doc fidelity)* |
| **C2** | Per-trade labels are path-dependent functions of the exit policy | Stated 5-trigger exit design | None | `TradeSimulator` implements what the docs describe | `tradeSimulator.ts` showing labels computed on fixed-horizon forward returns | **Established** *(conditional)* |
| **C3** | The composite was never fit to a target variable | Stated hand weights + menu selection | None | No undocumented fitting step exists | Evidence weights were estimated by optimization against forward returns | **Established** *(conditional)* |
| **C4** | Returns are measured in absolute, not residual, space | Stated design; the horizon study's "tail is beta" finding | None | — | A residualized study I haven't been shown | **Established** *(conditional)* |
| **C5** | No multiple-testing correction was applied | Absence across all docs | Absence of evidence ≠ evidence of absence | Undocumented work doesn't exist | A DSR/PBO computation that was run but not written up | **Established, weakly** |
| **C6** | ρ≈0 may be a measurement artifact rather than a finding | Estimator unspecified in docs | If computed correctly, it's real evidence | That "Spearman ρ" is ambiguous as documented | **`attribution.ts` source** | **STILL UNCERTAIN — ~50/50** |
| **C7** | The six negatives are not independent | Shared pipeline | B12/B13 may be cross-sectional and genuinely independent | All studies route through one label | **`events/study.ts`, `delivery/study.ts`** | **STILL UNCERTAIN — partially retracted already** |
| **C8** | B11's "allocation isn't the bottleneck" is inverted | Power argument | Their seeded-random control was well-designed | 2-slot tests have no discriminating power | `breadth_comparison.csv` | **STILL UNCERTAIN** |
| **C9** | Positive controls will fail through the pipeline | My prior only | None — untested | — | Running it | **PREDICTION, NOT CONCLUSION** |
| **C10** | Free data avenues are not exhausted | 11 named unheld datasets | — | They'd have documented holding them | Evidence the datasets are held | **Established, weakly** |
| **C11** | **The engineering is excellent** | Documentation of practices hard to fake | **I have never read one line of this codebase** | Docs describe the implementation accurately | Any code review | **STILL UNCERTAIN — I overstated this in review #1** |

**C11 deserves emphasis.** I awarded 8.5/10 for engineering and called it "better than most funds" having read exactly zero source files. That was not a defensible assessment; it was a review of documentation quality. I retract the score and replace it with: *the documentation describes practices that, if implemented as described, would be excellent.*

---

## Task 2 — Hidden assumptions not covered in the Evidence Request

Eighteen additional failure modes. Several are material and I missed them.

### Material — could change the verdict

**H-1. Benchmark construction: TRI vs PRI.**
Every comparison is "vs Nifty B&H." **Is that the Nifty 50 Price Index or the Total Return Index?** Indian dividend yield ≈ 1.2–1.5%/yr; over 5.5 years that is ~7–9% cumulative. If the strategy series includes dividends (or is dividend-agnostic) while the benchmark is PRI, the benchmark is *understated* and the strategy looks better than it is. If the reverse, the strategy is unfairly penalized. **This directly affects the −6.5% vs +0.8% gate.** Not mentioned anywhere in the documentation.
→ *Request: state the exact Nifty series used, with source and whether it is TRI.*

**H-2. Sector mapping is timestamped "today."**
Sectors come from the current instrument master and are applied retroactively across 5.5 years. NSE's taxonomy drifts (you documented this for midcaps). A company reclassified in 2024 carries its 2024 sector into 2021 data. This injects lookahead into **SectorRelativeStrength** (peer group composition) and into the **1-per-sector portfolio cap** (which names compete for a slot).
→ *Request: is there any point-in-time sector history, or is sector a single current-value field?*

**H-3. `DataQualityService` is a survivorship filter operating inside factor computation.**
Instruments scoring < 0.8 are skipped. Rejection is driven by gaps, staleness, and malformed candles — **all of which correlate with distress, trading halts, and low liquidity.** Distressed names are systematically excluded from the trade universe *on exactly the days they are most distressed.* This is survivorship bias operating at the daily level, entirely separate from the index-constituent survivorship you repaired. Its direction is optimistic: it removes candidates that were about to perform badly.
→ *Request: `DataQualityService` rejection log — which instruments, which dates, and the forward return of rejected names vs accepted names.*

**H-4. Equal-weight decile results are dominated by the smallest, least liquid names.**
The quantile study I requested defaults to equal weighting. In every published cross-sectional study, EW results are systematically stronger than VW because they overweight illiquid microcaps where costs are prohibitive. **Both must be reported.** This is a hole in my own Evidence Request.
→ *Add: value-weighted decile returns alongside equal-weighted.*

**H-5. Residualized deciles were not requested — only raw and market-excess.**
A factor can show flat raw deciles and clean residual deciles if beta dispersion swamps the signal. My Q5 asked for raw and market-excess but **not full residualization against sector, size, and beta.** A real signal could pass through my own master test undetected.
→ *Add: decile returns on returns residualized against (market, sector, size, prior-12m momentum).*

**H-6. The 5-day re-signal cooldown is an arbitrary, config-independent filter on the signal set.**
It was designed to keep the signal set stable across sweeps — a legitimate engineering choice with an un-analyzed research cost. If a stock's strongest setups cluster (a name breaking out repeatedly during a strong trend), the cooldown removes exactly the re-entries most likely to be profitable, uniformly across every study.
→ *Request: rerun the master quantile study with cooldown = 0.*

**H-7. Retroactive split adjustment embeds future knowledge in past price levels.**
Back-adjusting a 2024 split rewrites 2021–2023 prices. Return *ratios* are preserved (fine for factors), but the **₹-denominated position sizing** (`allocatedCapital / entry`) uses adjusted prices. Backtested position sizes therefore differ from what was actually purchasable at the time. Small effect, but it makes the portfolio simulation not-quite-replayable.

### Worth checking — unlikely to flip the verdict

**H-8.** GDELT `availableAt` = `publishedAt + latency margin`. **What is the margin, numerically?** If under ~24h it is plausibly lookahead-contaminated for a daily signal.

**H-9.** Index-membership ±1-reconstitution error — **which direction does it bias?** Holding a name too long after index exit adds losers (conservative); dropping too early removes losers (optimistic). Undetermined in the docs.

**H-10.** Are the news midnight-cutoff convention and the fundamentals `availableAt` convention **identical**? An inconsistency between the two loaders is a classic subtle leak.

**H-11.** P/E outliers are **excluded, not winsorized.** Exclusion changes peer-set cardinality, which changes percentile denominators. If loss-makers cluster by sector and period, the value component's scale drifts systematically over time.

**H-12.** `tradingDayFraction = 0.94` is hardcoded. Actual holiday density varies year to year, so continuity scores — and therefore the DQ rejection rate — drift by calendar year.

**H-13.** Entry fills at "next day's open." **Is that the auction print?** Indian opening auctions can be unrepresentative and are not reliably executable at size.

**H-14.** The golden fixture uses 15 stocks. **How were they chosen?** Non-random selection means determinism is verified on a potentially unrepresentative subset.

**H-15.** Garden of forking paths. Every study's design was informed by the previous study's results **on the same data**. The effective trial count vastly exceeds any nominal count, and no reported OOS figure is honestly discountable without it.

**H-16.** Internal publication bias. Retained findings are those that survived your scrutiny — itself a selection process. The negatives that survived may be over-represented relative to ones abandoned mid-flight.

**H-17.** FinBERT's pretraining corpus predates the backtest window, which is correct — but confirm the pinned revision's training cutoff is genuinely before 2021.

**H-18.** Cost model is size-blind. At your actual ₹1L notional, fixed DP charges dominate and 0.25% is *optimistic*; at institutional size, impact dominates and it is *also* wrong. Neither regime is modeled, so no capacity statement is possible in either direction.

---

## Task 3 — If every Level 1 experiment succeeds, what could still fool us?

Iterating until no reasonable alternative remains.

**Round 1.** Suppose the positive control passes and composite deciles are flat.
→ *Alternative:* the composite is a bad combination of individually-informative features that cancel. **Addressed** — Q6 tests all 8 factors separately.

**Round 2.** Suppose all 8 factors show flat deciles too.
→ *Alternative:* signal exists only in residual space, swamped by beta dispersion. **Was NOT addressed** — now covered by H-5.

**Round 3.** Suppose residualized deciles are also flat.
→ *Alternative:* signal is conditional — present in one regime, absent or inverted in another, averaging to zero. **Partially addressed** (E11 was Level 2). **Promoting to Level 1.**

**Round 4.** Suppose regime-conditional deciles are flat.
→ *Alternative:* signal exists outside the tested horizon window (< 1 day or > 63 days). Weak prior, cheaply testable by extending the IC decay curve to h=126.

**Round 5.** Suppose the decay curve is flat across all horizons.
→ *Alternative:* off-by-one date alignment — forward return computed from t rather than t+1, or the factor computed on t+1 data. A one-day misalignment destroys any real IC and produces exactly this pattern. **Not addressed anywhere.** → *Requires an explicit alignment unit test: inject a synthetic factor equal to the known forward return; the harness must return IC ≈ 1.0. If it doesn't, the harness is broken.*

**Round 6.** Suppose the synthetic-signal test returns IC ≈ 1.0 and everything else is flat.
→ *Alternative:* equal-weighting masks a value-weighted effect or vice versa. **Addressed** by H-4.

**Round 7.** Suppose EW and VW both flat, alignment verified, positive control passed, residualized and regime-conditional both flat.
→ **No reasonable alternative remains.** At that point H1 is established: these features contain no cross-sectional predictive information in this universe over this period. I would sign that conclusion.

**The synthetic-signal alignment test (Round 5) is the single cheapest and most important addition to the entire evidence program.** It is thirty minutes of work and it validates the harness absolutely. No result from any harness should be believed before it passes.

---

## Task 4 — Falsification matrix

| Hypothesis | Evidence required | Experiment | Expected outcome (my prior) | Alternative outcome | Which conclusion changes |
|---|---|---|---|---|---|
| **H0: Harness is correctly aligned** | Synthetic factor = forward return returns IC ≈ 1.0 | Inject known signal | IC ≈ 1.0 | IC ≪ 1 → **everything void** | All |
| **H5: Price data corrupt** | P1–P5 SQL, corporate-action reconciliation, TRI/PRI confirmation | E0 + H-1 | Clean, minor issues | Systematic errors → **all results void** | All |
| **H2a: ρ estimator invalid** | `attribution.ts` source | Read code | 50/50 | If cross-sectional rank IC vs *forward* returns → my critique collapses | A vs C |
| **H2b: Harness invalid** | Known anomaly through pipeline | E3 | Fails (55%) | Passes → instrument sound, negatives real | A vs C |
| **H1: No signal** | EW + VW + residualized + regime-conditional deciles, all horizons | E4 + H-4/H-5 + E11 | Genuinely unknown | Any monotone spread with t≥3 → signal exists | A vs B |
| **H3: Exits destroy edge** | MFE/MAE per trade | E5 | MFE ≫ realized (my prior) | MFE ≈ realized → exits exonerated | B |
| **H4: Construction destroys edge** | 2/20/50 slot comparison | E6 | 50 ≫ 2 (my prior) | All equally poor → B11 stands | B |
| **H6: DQ filter is a survivorship filter** | Forward returns of rejected vs accepted | New | Rejected underperform | No difference → filter is benign | Magnitude of all results |
| **H7: Sector lookahead** | PIT sector history existence | Check schema | Single current value → lookahead present | PIT history exists → clean | SectorRS validity |
| **H8: Benchmark understated** | TRI vs PRI confirmation | Check source | Unknown | PRI used → gate is ~8pp harsher than reported | The decisive gate metric |

---

## Task 5 — Destroying it from both directions

### Assume the strategy has ZERO edge. What would prove me wrong?

1. Any single factor with **monotone deciles, Q10−Q1 > 0, Newey-West t ≥ 3** on residualized returns, in both EW and VW, surviving the trial-count discount. **SectorRelativeStrength is the most likely candidate** — it is the only cross-sectional factor and the only one that measurably helped.
2. `mean(MFE_21d) − mean(realized)` large and positive, with a high share of stop-loss exits on trades that later exceeded 2R.
3. 50-slot portfolio materially outperforming 2-slot on identical signals.
4. Positive control passing at deciles while the composite fails — proving the harness works and isolating the failure to the features.

**Any one of these falsifies "zero edge."** None has been tested.

### Assume the strategy has a STRONG edge. What would prove me wrong?

1. Positive control **passes** cleanly, and all 8 factors plus composite show flat deciles across raw, excess, residualized, EW, VW, all horizons, all regimes.
2. Bootstrap CI on expectancy **tight** around zero (e.g. [−0.09, +0.01]) rather than wide.
3. MFE ≈ realized return — nothing was left on the table.
4. 2-slot ≈ 20-slot ≈ 50-slot — breadth changes nothing.
5. Synthetic-signal test returns IC ≈ 1.0, proving the harness can detect signal when it exists.

**All five together would establish H1 conclusively.** That is the strongest available negative and it is achievable in about three weeks.

---

## Task 6 — What would make me retract each conclusion?

| Conclusion | Retraction trigger | Exists? |
|---|---|---|
| Breadth arithmetic (C1) | `concurrency.csv` showing concurrency ≫ 2 | ✅ Yes → **not established absolutely** |
| Label contamination (C2) | `tradeSimulator.ts` showing fixed-horizon labels | ✅ Yes → **not established absolutely** |
| Composite never fit (C3) | Documented weight optimization | ✅ Yes |
| Absolute-not-residual (C4) | A residualized study | ✅ Yes |
| ρ may be artifact (C6) | The source code | ✅ Yes → **50/50** |
| Six negatives correlated (C7) | B12/B13 method | ✅ Yes → **already partly retracted** |
| B11 inverted (C8) | Breadth experiment | ✅ Yes |
| Engineering excellent (C11) | Code review | ✅ Yes → **retracted pending evidence** |
| **Free avenues not exhausted (C10)** | Evidence the 11 datasets are held | ✅ Yes, trivially |

**Every conclusion I hold is falsifiable by an artifact that exists and has not been produced.** By the standard set in the brief, **none of my conclusions is yet Scientifically Established** — they are *established conditional on the documentation being an accurate description of the implementation*, which is a materially weaker claim than I have been making.

---

## Task 7 — What JF / JFE / RFS referees would demand

Only analyses that materially affect the conclusion.

1. **Fama-MacBeth cross-sectional regressions** with Newey-West standard errors — not IC alone. Referees want coefficients and t-stats on standardized characteristics.
2. **Alpha against an established factor model.** Is the signal anything beyond CAPM/FF3/Carhart-4/FF5 exposure? A referee's first question is always *"is this just momentum in disguise?"* — and given your Trend/Momentum/RS collinearity, that question is pointed.
3. **Double-sorted portfolios** — independently sorted on size and the signal, to prove the effect is not a size proxy.
4. **Value-weighted results reported alongside equal-weighted.** Non-negotiable; EW-only results are routinely desk-rejected.
5. **Subperiod stability** — split-half and yearly. A referee will not accept a full-sample result without it.
6. **Transaction-cost sensitivity curve**, not a point estimate. At what cost level does the effect vanish?
7. **Microcap / liquidity screen robustness** — results with and without the smallest quintile.
8. **Multiple-testing disclosure** — how many specifications were run. Harvey-Liu-Zhu's t > 3.0 hurdle would be applied explicitly.
9. **Economic mechanism.** Referees reject data-mined results without a story: who is on the other side, why does the mispricing persist, why is it not arbitraged.
10. **Out-of-sample or out-of-country replication.**

**On items 1–5 and 8, this project currently has nothing.** A negative-results paper would face the identical bar — a null result is only publishable if the test had demonstrable power to detect the effect, which returns directly to the power analysis.

---

## Task 8 — What the funds would ask

Only questions that could change the capital decision.

**AQR (factor purity):** What is the correlation of this signal to standard factor returns? Is the alpha incremental to momentum? What is the factor-model-adjusted alpha and its t-stat?

**Two Sigma (research process):** How many hypotheses have you tested in total? Show me the trial register. What is your deflated Sharpe? How do you prevent researchers re-using the same test set?

**Renaissance-style (data integrity):** Show me the raw-to-adjusted price reconciliation. What is your vendor redundancy? Can you reproduce a result from six months ago bit-exact? *(This is the one question where you would answer exceptionally well — version stamps, golden gate, content-addressed Bronze layer.)*

**Jane Street / Citadel (execution reality):** What is the capacity in rupees at a 15% ADV participation cap before the edge is consumed? What is the realized vs modeled slippage from live fills? What is the turnover and its cost? *(You have no live fills and no impact model — this line of questioning terminates the meeting.)*

**All of them:** What is the decay profile — has the signal weakened since discovery? What is the maximum drawdown in the worst regime not present in your sample? Who is on the other side of the trade, and why do they keep taking it?

**The one question none of them would need to ask:** whether the results are reproducible. That is your genuine institutional-grade asset.

---

## Task 9 — The Remaining Uncertainty, categorized

### Category A — Without these, no final conclusion is scientifically valid

| # | Item | Time |
|---|---|---|
| A1 | **Synthetic-signal alignment test** (inject factor = forward return, expect IC ≈ 1.0) | 0.5d |
| A2 | **`attribution.ts` source** — what was ρ correlated *against*? | 0.5h |
| A3 | **`events/study.ts` + `delivery/study.ts`** — cross-sectional or trade-routed? | 0.5h |
| A4 | **Price integrity audit** + TRI/PRI benchmark confirmation (H-1) | 3d |
| A5 | **Positive control** through both harness and full pipeline | 4d |
| A6 | **Master quantile study** — composite + 8 factors × {raw, market-excess, **residualized**} × {EW, **VW**} × 6 horizons | 5d |
| A7 | **MFE/MAE decomposition** | 2d |
| A8 | **Breadth experiment** 2/20/50 | 3d |
| A9 | **Bootstrap CI on expectancy + power analysis** | 2d |
| A10 | **DQ-filter survivorship test** — forward returns of rejected vs accepted names (H-3) | 1d |
| A11 | **Regime-conditional deciles** *(promoted from Level 2 per Task 3 Round 3)* | 2d |
| A12 | **Sector PIT confirmation** (H-2) | 0.5d |
| A13 | **COVERAGE reconciliation** −6.5% vs −17.08% | 0.5d |

**Total ≈ 3.5 weeks. All on existing data. Zero spend.**

### Category B — Increases confidence, will not change the conclusion

Factor distributions/degeneracy · correlation matrix and effective rank · IC decay to h=126 · effective sample size · trial count and DSR · cooldown=0 rerun (H-6) · GDELT latency margin (H-8) · restatement handling · dividend adjustment status · rolling IC.

### Category C — Interesting, unnecessary

Permutation tests (bootstrap CI covers it) · PBO/CSCV · golden-fixture selection method · `tradingDayFraction` sensitivity · study-set overlap Jaccard · split-adjustment sizing artifact (H-7).

---

## Task 10 — The strongest conclusion available today

### Statement

> **The QuantSwing research program has never estimated the quantity its central claim depends on.**
>
> Three things are established (conditional on documentation fidelity): the deployed 2-slot portfolio underperforms Nifty over the tested windows; the per-trade label is a path-dependent function of the exit policy and therefore not a consistent estimator of predictive information; and the portfolio's breadth is too low for portfolio-level inference about signal quality.
>
> **Whether the eight features contain cross-sectional predictive information is unknown.** It has not been measured by the project, and it cannot be inferred from any result the project has produced.

### Confidence: ~88%

### Exactly why it is not higher

Three reasons, in order of weight:

1. **Q1 is unanswered and is dispositive.** If `attribution.ts` computed per-date cross-sectional rank IC of factor scores against **forward returns**, then the parameter *was* estimated, ρ≈0 is direct evidence for H1, and my statement above is simply false. If it correlated factor scores against **realized trade returns**, the statement holds completely. **This one code path is the fulcrum of the entire verdict**, and it is a thirty-minute read.
2. **I have read no source code.** Every "established conditional on documentation fidelity" caveat is load-bearing. Documentation-implementation drift is the single most common finding in real due diligence.
3. **Newly identified confounds (H-1, H-2, H-3) are unquantified** and at least one — benchmark TRI vs PRI — could move the decisive gate metric by ~8 percentage points in either direction.

### Evidence ladder

| Target | Minimum required | Time |
|---|---|---|
| **95%** | A1 (alignment test) + A2 (ρ source) + A3 (study methods) + A13 (reconciliation) + A12 (sector PIT) + H-1 (TRI/PRI) | **~2 days** |
| **99%** | The above + A4 (price audit) + A5 (positive control) + A6 (full quantile study with residualized/VW) + A7 (MFE) + A8 (breadth) + A9 (CI/power) + A10 (DQ survivorship) + A11 (regime) | **~3.5 weeks** |
| **99.9%** | The above + independent reimplementation of the quantile harness by a second party reproducing A6 + full Fama-MacBeth with factor-model controls + complete trial register with DSR | **~2–3 months** |

**99.9% is likely unattainable in principle.** Non-stationarity over a 5.5-year window containing one market cycle means "these features carry no information" can never be separated from "these features carried information that decayed before the sample" with the data available. That residual is irreducible without more history or another market.

---

## Final Answer

# **Conclusion C**

**The evidence is insufficient to distinguish A from B.**

### Why C, precisely

This is **not** a statement that more data is needed. It is a statement about **identification**.

The parameter of interest is the cross-sectional association between factor scores and forward returns. The project's principal estimator — per-trade expectancy after path-dependent exits, aggregated over a 2-position portfolio — is **not consistent for that parameter**. It measures the composition `signal ∘ gates ∘ exits ∘ construction ∘ costs`. A zero reading is produced identically by a null signal and by a real signal annihilated at any downstream stage.

Six studies returning near-zero through a non-identifying estimator constitute **one uninformative reading repeated six times**, not six independent negatives. More observations through the same estimator would not help; the estimator does not converge on the quantity in question.

### Why not the alternatives

**Not A.** Concluding "no predictive information" requires that the quantity was estimated. It was not — pending Q1, which could reverse this in half an hour. A is *live*, and if `attribution.ts` computed rank IC against forward returns with proper t-stats, **A becomes the correct answer and I retract C.**

**Not B.** Symmetrically, no evidence supports the existence of a signal either. My prior that SectorRelativeStrength carries real IC is a hypothesis with a plausible mechanism (it is the only cross-sectional and only demonstrably-helpful factor), not a finding. Asserting B would repeat the project's original error in the opposite direction.

**Not D.** D overstates it. The reproducibility infrastructure — golden determinism gate, version stamping, point-in-time discipline, content-addressed raw capture — is genuinely sound as documented, and the survivorship repair was competently executed. The problem is not untrustworthy infrastructure; it is **correct infrastructure aimed at the wrong estimand**. That distinction matters, because D implies rebuilding the platform while the truth implies rebuilding only the measurement layer — weeks, not quarters.

**Not E.** C, stated with the identification qualifier above, is precise enough.

### The investment decision

**On a $10M research budget: I would not approve the pivot, and I would not approve the shutdown.** I would approve **3.5 weeks and zero rupees** to execute Category A.

The asymmetry is decisive. Category A costs nothing but time, uses only data already on disk, and resolves the question that determines whether the correct next step is *buy consensus estimates*, *rebuild the measurement layer*, or *stop*. Committing capital to Option C before A2 has been read — a thirty-minute code review — would be indefensible at any investment committee.

### If I am told no further evidence will be produced

Then the honest terminal verdict is: **the project demonstrated that a hand-weighted technical rubric, evaluated through a non-identifying estimator on a 2-position portfolio, does not beat the Nifty.** That is a true statement, and a considerably narrower one than "free-data swing trading on Indian equities has no edge." The documentation currently asserts the second. Only the first is supported.

---

*Final verdict rendered against QuantSwing Master Reference (`93cbb86`), Institutional Review, Due Diligence, and Evidence Request. No raw research artifacts were provided at any stage — a fact that is itself the principal constraint on this verdict's strength.*
