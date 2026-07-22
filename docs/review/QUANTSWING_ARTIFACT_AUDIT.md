# QuantSwing — Artifact Verification Audit

**Role: independent auditor. Nothing is accepted without a raw artifact. Every unverifiable claim is marked `NOT VERIFIABLE`.**

---

## Phase 1 — Audit of my own Final Verdict

Treating the Final Verdict as though written by a third party whose competence is unknown.

| # | Conclusion | Evidence Type | Verified? | Required Artifact | Verification Method | Confidence |
|---|---|---|---|---|---|---|
| 1 | Portfolio breadth ≈72 bets/yr → underpowered | Arithmetic on self-reported config | ❌ **No** | `concurrency.csv`; `productionStrategy.ts`; env dump | Count distinct open positions per date; confirm `PORTFOLIO_MAX_OPEN_POSITIONS` | Med |
| 2 | Per-trade label is exit-contaminated | Prose description | ❌ **No** | `tradeSimulator.ts` lines computing return | Read return computation; confirm it is exit-path-dependent | Med |
| 3 | Composite never fit to a target | Absence in docs | ❌ **No** | `git log --all -S "optimize\|fit\|minimize" -- src/strategy/` | Search history for any fitting step | Low-Med |
| 4 | Returns measured in absolute space | Prose | ❌ **No** | `metrics.ts`, `backtestEngine.ts` | Confirm no residualization applied | Med |
| 5 | No multiple-testing correction | Absence in docs | ❌ **No** | `grep -ri "deflated\|pbo\|bonferroni\|fdr" src/` | Absence of implementation | Low |
| 6 | **ρ≈0 may be a measurement artifact** | None | ❌ **No** | **`attribution.ts` — function body + call site** | Determine what ρ was correlated *against* | **None — 50/50** |
| 7 | Six negatives are correlated | Inference from prose | ❌ **No** | `events/study.ts`, `delivery/study.ts` | Classify each as cross-sectional vs trade-routed | Low |
| 8 | B11 conclusion inverted | Power argument only | ❌ **No** | `breadth_comparison.csv` | Run 2/20/50 slots on identical signals | Low |
| 9 | Engineering is excellent | **Documentation only — zero code read** | ❌ **NOT VERIFIABLE as stated** | Any source file | Code review | **None — retracted** |
| 10 | Survivorship repair is sound | `SURVIVORSHIP.md` | ❌ **No — circular, see Phase 6** | Ledger + `portfolioSimulator.ts` | Independent recomputation | Low |
| 11 | PIT discipline is excellent | Prose | ❌ **No** | SQL N3 + `sentimentAggregate.ts` + fundamentals loader | Confirm both loaders use the same cutoff convention | Low-Med |
| 12 | Free data avenues not exhausted | Absence in docs | ⚠️ **Partial** | `\dt` schema dump | Confirm no options/flow/pledge tables exist | Med-High |
| 13 | The −6.5%/−17.08% discrepancy is real | Two documents | ✅ **Verified** (documents disagree; that fact is itself the artifact) | — | — | High |

**Result: 12 of 13 conclusions in my own Final Verdict are unverified.** One is verified only in the trivial sense that two documents visibly contradict each other. My stated 88% confidence was not defensible; it should have been expressed as *conditional on documentation fidelity*, which no artifact has yet established.

---

## Phase 2 — Artifact Dependency Graph

```
FINAL VERDICT (A / B / C / D)
│
├─ [BRANCH 1] Was the parameter ever estimated?
│   └─ attribution.ts :: rank-correlation fn + call site        ◄── ROOT
│       ├─ requires: what is argument 2? (forward return vs trade return)
│       ├─ requires: is it per-date or pooled?
│       ├─ requires: tie-handling in the rank fn  ── Trend has 5 discrete values
│       └─ requires: forward-return construction
│           └─ requires: date alignment (t vs t+1)
│               └─ VALIDATED BY: synthetic-signal test (IC must ≈ 1.0)
│
├─ [BRANCH 2] Is the underlying data sound?
│   ├─ SQL P2 (extreme returns) ── unexplained clusters ⇒ all void
│   ├─ benchmark series identity (TRI vs PRI) ── ~8pp on the decisive gate
│   └─ DataQualityService rejection log ── hidden daily survivorship filter
│
├─ [BRANCH 3] Is the label what I claimed?
│   └─ tradeSimulator.ts :: return computation
│       └─ requires: exit priority order + fill assumptions
│
├─ [BRANCH 4] Is the portfolio what I claimed?
│   ├─ concurrency.csv
│   └─ portfolioManager.ts :: sizing + slot allocation
│
└─ [BRANCH 5] Are the six studies independent?
    ├─ events/study.ts     :: forward-return method
    └─ delivery/study.ts   :: forward-return method
```

**Critical structural observation:** Branch 1's entire chain — rank IC implementation, forward-return construction, date alignment, tie handling — collapses into **one test**. Injecting a synthetic factor equal to the known forward return must produce IC ≈ 1.0. If it does, every link in that chain is simultaneously validated. If it doesn't, every number the harness has ever produced is void.

**This replaces reading four files with running one test.**

---

## Phase 3 — Collapsing the Evidence Tree

Previously requested: ~30 artifacts. Actual minimum:

### The irreducible set: **2 artifacts**

| # | Artifact | What it decides |
|---|---|---|
| **1** | `attribution.ts` — rank-correlation function body + call site | Whether the parameter of interest was ever estimated. **Fulcrum between Conclusion A and Conclusion C.** |
| **2** | Synthetic-signal test result | Whether any harness output can be believed at all. Validates date alignment, forward-return construction, rank implementation, and tie handling in a single measurement. |

**Why these two and nothing else:** every other requested artifact is either (a) downstream of what #1 reveals, or (b) meaningless until #2 passes. Running the master quantile study before #2 passes would produce a number nobody should trust; reading `tradeSimulator.ts`, `metrics.ts`, `walkForward.ts` and `portfolioSimulator.ts` individually is a slower, less complete substitute for #2.

### Conditional expansion — only if #1 shows the parameter was NOT estimated

| # | Artifact | Trigger |
|---|---|---|
| 3 | `quantile_study.csv` (composite + 8 factors × {raw, residualized} × {EW, VW} × 6 horizons) | #1 shows trade-return or pooled correlation |
| 4 | `positive_control_quantile.csv` | Always, alongside #3 — a harness that cannot detect a known anomaly cannot support a null |

### Conditional expansion — only if #3 shows monotone deciles

| # | Artifact | Trigger |
|---|---|---|
| 5 | MFE/MAE column added to the B9 ledger | Signal exists → locate where it died |
| 6 | `breadth_comparison.csv` (2/20/50 slots) | Same |

### Always-run, negligible cost

| # | Artifact | Cost |
|---|---|---|
| 7 | SQL P2 (extreme returns) | 10 min — can void everything |
| 8 | Benchmark series identity (one grep) | 5 min — ~8pp on the decisive metric |

**30 artifacts → 2 mandatory + 6 conditional.** Everything previously requested under Category B and C is removed: it would refine numbers without changing which of A/B/C/D is correct.

---

## Phase 4 — Bayesian Information Gain Ranking

| Rank | Artifact | P(changes conclusion) | Info gain | Time | Depends on | **Gain/hour** |
|---|---|---|---|---|---|---|
| 1 | `attribution.ts` fn + call site | **0.50** | Very high | **0.5h** | none | **Extreme** |
| 2 | Synthetic-signal test | 0.15 | Very high (total validator) | **0.5h** | harness exists | **Extreme** |
| 3 | SQL P2 extreme returns | 0.25 | High (voids all) | **0.2h** | none | **Extreme** |
| 4 | Benchmark TRI/PRI grep | 0.20 | Med-high | **0.1h** | none | **Extreme** |
| 5 | `events/` + `delivery/study.ts` | 0.30 | Medium | 0.3h | none | Very high |
| 6 | Tie-handling in rank fn | 0.20 | Medium | 0.2h | #1 | Very high |
| 7 | `concurrency.csv` | 0.15 | Medium | 2h | ledger | High |
| 8 | Schema dump (`\dt`) | 0.10 | Medium | 0.1h | none | High |
| 9 | Quantile study (full) | **0.60** | **Highest absolute** | 40h | #2 | Medium |
| 10 | Positive control | 0.35 | Very high | 32h | #2 | Medium |
| 11 | MFE/MAE | 0.40 | High | 16h | #9 positive | Medium |
| 12 | Breadth 2/20/50 | 0.35 | High | 24h | #9 positive | Medium |
| 13 | Bootstrap CI on existing ledger | 0.30 | Med-high | 8h | ledger export | Medium |
| 14 | DQ rejection log | 0.20 | Medium | 8h | none | Low-med |
| 15 | `git log` trial count | 0.10 | Medium | 1h | none | Low-med |

**Items 1–5 total 1.6 hours and carry roughly half the remaining decision weight.** Nothing else in the project comes close on gain per hour.

---

## Phase 5 — Stop Rule Applied

Every artifact tested against: *if it confirms expectation, what uncertainty disappears? If it contradicts, what conclusion changes?*

### Retained

| Artifact | Confirms → | Contradicts → |
|---|---|---|
| `attribution.ts` | C stands; quantile study becomes mandatory | **A becomes correct; C retracted** |
| Synthetic test | Harness trustworthy; results interpretable | **D — everything void** |
| SQL P2 | Data sound | **D — everything void** |
| Benchmark grep | Gate metric as reported | Gate is ~8pp different; magnitude of failure restated |
| study.ts ×2 | Six negatives correlated | Two are independent; existing evidence stronger |
| Quantile study | A confirmed | **B — signal exists** |
| Positive control | Harness sound | **D — harness cannot detect known effects** |
| MFE | Exits exonerated | **B via exits** |
| Breadth | B11 stands | **B via construction; B11 inverted** |

### Removed under the stop rule

| Removed | Reason |
|---|---|
| Factor correlation matrix / effective rank | Explains *why* a null occurred; doesn't change whether it occurred |
| Factor distribution histograms | Same — mechanism, not verdict |
| IC decay curve | Only meaningful if IC ≠ 0; subsumed by the quantile study's horizon dimension |
| Effective sample size | Refines a CI already produced by bootstrap |
| Trial count / DSR | Discounts a positive result; irrelevant to a null |
| Permutation tests | Bootstrap CI covers the same inferential ground |
| PBO / CSCV | Applies to config selection, which is downstream of whether signal exists |
| Rolling IC | Distinguishes decay from absence — a follow-up question, not a verdict question |
| Restatement handling | Affects B5 magnitude only |
| Cooldown=0 rerun | Second-order |
| GDELT latency margin | Affects sentiment tier only |
| Study-set overlap Jaccard | Measures a claim of mine that the study.ts read answers directly |
| News coverage density SQL | Determines whether B7 meant anything — but B7 is not load-bearing for A/B/C/D |

**13 of 15 previously-requested Category B/C items removed.** None can flip the verdict.

---

## Phase 6 — Circular Reasoning Audit

Genuine circular dependencies found in my own prior reports.

| # | Circularity | Structure | Severity |
|---|---|---|---|
| **1** | **Engineering quality** | "The engineering is excellent *because* the documentation describes excellent practices" — where the documentation is authored by the party under review and its accuracy is the very thing in question. | **Severe** — already retracted |
| **2** | **Survivorship repair** | "Survivorship is repaired *because* `SURVIVORSHIP.md` shows COVERAGE unchanged." But COVERAGE was computed by `portfolioSimulator`, whose correctness is under review. The repair is validated by the instrument whose validity the repair was meant to support. | **Severe** |
| **3** | **PIT discipline** | "PIT is excellent *because* the docs describe `availableAt` correctly" — while simultaneously arguing the docs may not describe the implementation accurately. Cannot hold both. | **Moderate** |
| **4** | **Label contamination** | "The negatives are uninformative *because* the label is exit-contaminated" — where knowledge of the label comes only from the same documentation whose fidelity is disputed. | **Moderate** |
| **5** | **Six negatives correlated** | "They share one pipeline *because* the docs describe one pipeline." Same structure as #4. | **Moderate** |
| **6** | **Trial count** | I requested a self-reported trial count in order to discount results for selection bias — but selection bias is precisely what makes self-reported trial counts unreliable. **Structurally unverifiable from inside the project.** | **Severe — and unfixable by request** |

**Resolution for #6:** `git log --all --oneline -- src/backtest/ docs/` gives an *objective lower bound* on experiment count, independent of self-report. Commit timestamps and branch structure cannot be retroactively edited without detection. This is the only non-circular route to a trial denominator.

**Resolution for #2:** independently recompute COVERAGE from a raw trade ledger using an external tool (pandas, not their code). If the recomputation matches, the simulator is validated by something outside itself.

**Meta-observation:** circularities #3, #4, #5 all share one root — I have been treating documentation as evidence about implementation while simultaneously arguing documentation may not reflect implementation. **A single code read resolves all three.** They are not independent problems.

---

## Phase 7 — Hidden Assumptions Capable of Changing the Verdict

New; not raised in any prior document.

| # | Assumption | Failure mode | Verdict impact |
|---|---|---|---|
| **A** | **Rank correlation handles ties with mid-ranks** | `Trend` takes only 5 discrete values, so ties are pervasive. Most naive rank implementations (and some library defaults) assign first-occurrence ranks. **First-occurrence ranking on a 5-valued variable makes IC essentially meaningless and biased toward zero.** | **High — could alone explain "ρ≈0 for Trend"** |
| **B** | **Float equality detects ties in the percentile function** | `(below + 0.5×equal)/total` requires `peerReturn === ownReturn`. Float equality on computed returns is essentially never true, so the tie branch may never execute — silently converting a mid-rank percentile into a strict-rank percentile. Affects **SectorRelativeStrength** and the **Fundamental value** component. | **Medium-high** |
| **C** | **Timezone consistency between the news cutoff and the candle date** | `availableAt` is a timestamp; `asOf` is a date. If "midnight of asOf" is computed in UTC while trade dates are IST, up to 5.5 hours of same-day news leaks in — or a day is wrongly excluded. | **High if present** |
| **D** | **Null factor scores are excluded, not coerced to 0** | On a 0–100 scale, 0 is maximally bearish, not neutral. If any aggregation path coerces null→0 rather than dropping the component, sparse factors (Sentiment, Fundamental) inject systematic bearish bias. | **High if present** |
| **E** | **Sector peer join is LEFT, not INNER** | An INNER join in the peer pre-pass silently drops names with missing sector or insufficient history, shrinking the peer set and distorting percentile denominators asymmetrically. | Medium |
| **F** | **Forward returns skip non-trading days correctly** | "7 days" must mean 7 *trading* days consistently across the label, the time-stop, and the study harness. A calendar/trading-day mismatch between the label and the exit rule silently misaligns everything. | **High if present** |
| **G** | **The benchmark series is the same instrument across the whole window** | If the NIFTY token or source changed mid-archive, the benchmark has a splice. Directly affects every excess-return computation. | Medium |
| **H** | **DataQualityService rejection is uncorrelated with forward returns** | Never tested. Rejection keys on gaps, staleness, and malformed candles — all correlated with distress and halts. Constitutes a daily-frequency survivorship filter operating inside factor computation. | **High** |

**Assumptions A and B are the highest-value checks in this entire document relative to their cost.** Both are resolved by reading two short functions. Either, if wrong, produces exactly the observed "ρ≈0 everywhere" pattern through a pure implementation bug — with no implication whatsoever about market efficiency.

---

## Phase 8 — Fastest Path to a Verdict

### Stage 1 — Under one hour

Paths are inferred from documented script names; map to actuals as needed.

| # | File | Function / block | Verify exactly this | Time |
|---|---|---|---|---|
| 1 | `src/backtest/attribution.ts` | the rank/Spearman function **and its call site** | **What is argument 2 — forward return, or realized trade return?** Is the correlation computed per-date and then averaged, or pooled across all (stock, date) pairs? | 15m |
| 2 | same file (or `src/lib/stats.ts`) | the ranking helper | **Tie handling: mid-rank or first-occurrence?** (Assumption A) | 5m |
| 3 | `src/factors/sectorRelativeStrengthFactor.ts` | percentile computation | **Is `equal` detected via float `===`?** (Assumption B) | 5m |
| 4 | `src/events/study.ts`, `src/delivery/study.ts` | forward-return computation | Cross-sectional decile on forward returns, or routed through `TradeSimulator`? | 10m |
| 5 | `grep -rn "NIFTY" src/backtest/ src/regime/` | benchmark loading | Which series — price index or total return? Single token across the full window? | 5m |
| 6 | psql | SQL P2 (extreme returns > 20%) | Any unexplained clusters, especially on shared dates | 10m |
| 7 | psql | `\dt` | Confirm no options / flow / pledge tables exist | 2m |
| 8 | `grep -rn "midnight\|startOfDay\|UTC\|setHours" src/news/ src/backtest/` | as-of cutoff | Timezone consistency (Assumption C) | 5m |

**Deliverable:** eight short answers. **These resolve the A-vs-C fulcrum and all three of the "documentation fidelity" circularities.**

### Stage 2 — One day

| # | Action | Expected output | Success | Failure |
|---|---|---|---|---|
| 1 | **Synthetic-signal test.** Inject a factor whose value = the known forward return; run through the IC/quantile harness | Scalar IC | **IC ≥ 0.95** | IC < 0.9 ⇒ harness broken ⇒ **VERDICT D**, stop |
| 2 | **Inverse synthetic test.** Inject factor = −(forward return) | Scalar IC | IC ≤ −0.95 | Asymmetry ⇒ sign bug |
| 3 | **Shuffled-label test.** Randomize forward returns within each date | IC distribution | Centred on 0, \|IC\| < 0.02 | Non-zero ⇒ leakage in the harness |
| 4 | Export B9 trade ledger to CSV | `ledger_b9_full.csv` | Row count matches reported n | Mismatch ⇒ reporting error |
| 5 | **Recompute expectancy and PF externally** (pandas, not their code) | Two scalars | Match reported −0.04% / 0.97 | Mismatch ⇒ metrics bug ⇒ resolves circularity #2 |
| 6 | Block-bootstrap 95% CI on expectancy from the exported ledger | Interval | CI excludes 0 either way | **CI spans [−0.3, +0.2] ⇒ no conclusion licensed** |
| 7 | Concurrency series from the ledger | `concurrency.csv` | Median ≈ 2 | ≫ 2 ⇒ my breadth argument weakens |
| 8 | `git log --all --oneline -- src/backtest/ docs/ \| wc -l` | Integer | Objective trial lower bound | — |

**Stage 2 requires no new research code** beyond the synthetic injection — items 4–8 are exports and external recomputation.

### Stage 3 — One week (only if Stage 2 passes and Stage 1 showed the parameter was not estimated)

| # | Experiment | Output |
|---|---|---|
| 1 | Master quantile study: composite + 8 factors × {raw, residualized vs market+sector+size} × {EW, VW} × h∈{1,5,10,21,63} | `quantile_study.csv`, CH1 |
| 2 | Positive control (12-1 momentum, Piotroski F) through the same harness | `positive_control.csv`, CH12 |
| 3 | *(conditional on #1 monotone)* MFE/MAE decomposition | CH3 |
| 4 | *(conditional on #1 monotone)* Breadth 2/20/50 | CH6 |
| 5 | DQ-rejection forward-return test | Rejected vs accepted mean forward return |

---

## Phase 9 — Binary Decision Gates

```
START
│
├─ SQL P2: unexplained extreme-return clusters?
│    YES → VERDICT D (data void). STOP.
│    NO  ↓
│
├─ Benchmark = PRI?
│    YES → record: gate metric ~8pp harsher than reported. CONTINUE.
│    NO  ↓
│
├─ Rank fn uses first-occurrence ties? OR percentile uses float `===`?
│    YES → all IC/percentile output is corrupt → VERDICT D. Fix, re-run, restart. STOP.
│    NO  ↓
│
├─ attribution.ts: ρ correlated against FORWARD returns, per-date, rank-based?
│    │
│    ├─ YES ──► the parameter WAS estimated
│    │         │
│    │         └─ Synthetic-signal test: IC ≥ 0.95?
│    │              NO  → VERDICT D (harness broken). STOP.
│    │              YES → their ρ≈0 is a REAL measurement
│    │                    └─► **VERDICT A** — no predictive information.
│    │                        My Conclusion C is RETRACTED. Pivot justified.
│    │
│    └─ NO (trade returns, or pooled) ──► the parameter was NEVER estimated
│              │
│              └─ Synthetic-signal test: IC ≥ 0.95?
│                   NO  → VERDICT D. STOP.
│                   YES ↓
│                        │
│                        └─ Positive control: monotone deciles, t ≥ 3?
│                             NO  → VERDICT D (harness cannot detect a known
│                                    anomaly; a null from it is uninformative). STOP.
│                             YES ↓
│                                  │
│                                  └─ Any factor: monotone deciles, t ≥ 3,
│                                     in BOTH EW and VW, on residualized returns?
│                                       │
│                                       ├─ NO → **VERDICT A** — no predictive
│                                       │        information. Conclusion C retracted.
│                                       │        Pivot justified.
│                                       │
│                                       └─ YES → SIGNAL EXISTS
│                                            │
│                                            ├─ MFE ≫ realized?
│                                            │    YES → **VERDICT B** (exits)
│                                            │
│                                            ├─ 50-slot ≫ 2-slot?
│                                            │    YES → **VERDICT B** (construction);
│                                            │          B11 inverted
│                                            │
│                                            └─ Neither → **VERDICT B** (costs /
│                                                 implementation). Signal real but
│                                                 not currently harvestable.
```

Every path terminates at exactly one of A, B, or D. **Conclusion C survives only while the tree is unexecuted** — which is the correct property for a verdict of "insufficient evidence."

---

## Phase 10 — Final Output

### 1. Top 10 highest-information artifacts

1. `attribution.ts` rank-correlation function + call site
2. Synthetic-signal test result (IC ≈ 1.0 check)
3. Tie-handling implementation in the ranking helper
4. SQL P2 extreme-returns output
5. Benchmark series identity (TRI vs PRI)
6. `events/study.ts` + `delivery/study.ts` forward-return method
7. Float-equality check in the percentile function
8. `quantile_study.csv` (conditional)
9. Externally recomputed expectancy + bootstrap CI from the raw ledger
10. `positive_control.csv` (conditional)

### 2. Top 10 source files to inspect

1. `src/backtest/attribution.ts`
2. the ranking/statistics helper it imports (`src/lib/stats.ts` or equivalent)
3. `src/factors/sectorRelativeStrengthFactor.ts` (percentile + float equality)
4. `src/events/study.ts`
5. `src/delivery/study.ts`
6. `src/backtest/tradeSimulator.ts` (return computation, exit priority)
7. `src/backtest/metrics.ts` (expectancy, PF definitions)
8. `src/backtest/backtestEngine.ts` (date alignment, forward-return construction)
9. `src/portfolio/portfolioManager.ts` (sizing, slot allocation)
10. `src/news/sentimentAggregate.ts` (null handling, timezone cutoff)

### 3. Top 10 experiments

1. Synthetic-signal injection (IC ≈ 1.0)
2. Inverse synthetic (IC ≈ −1.0)
3. Shuffled-label null (IC ≈ 0)
4. External recomputation of expectancy/PF from raw ledger
5. Block-bootstrap CI on expectancy
6. Master quantile study (residualized, EW + VW)
7. Positive control through the same harness
8. MFE/MAE decomposition
9. Breadth 2/20/50
10. DQ-rejection forward-return test

### 4. Fastest path to a final scientific verdict

**Stage 1 (1 hour) → Stage 2 (1 day) → Stage 3 (1 week, conditional).**
Best case — Stage 1 reveals correct rank IC against forward returns and Stage 2's synthetic test passes — **verdict in roughly one working day, with Stage 3 never executed.**

### 5. The single most important artifact

**`attribution.ts` — the rank-correlation function together with its call site.**
Thirty minutes. Roughly a 50% chance of flipping the verdict from C to A outright. No other artifact approaches this ratio, and every remaining branch of the decision tree is conditioned on it.

### 6. The artifact that can immediately invalidate all previous conclusions

**The synthetic-signal test.**
If a harness cannot recover IC ≈ 1.0 from a factor that *is* the forward return, then every number it has ever produced is void — your six negatives, my critique of them, and all four prior documents. It is also the only artifact that can void the work of both parties simultaneously.

Runner-up: SQL P2. Systematic price corruption voids the data layer beneath everything, but is more likely to be partial than total.

### 7. If I had one hour

Run all eight Stage 1 checks — but if forced to a single item, read `attribution.ts`'s call site and answer one question: **what is the second argument to the correlation function?** If it is a forward return, Conclusion A is probably correct and I retract C. If it is a realized trade return, Conclusion C is confirmed and the quantile study becomes mandatory.

### 8. If I had one day

Stage 1 in full, then the three synthetic-harness tests, then export the ledger and **recompute expectancy, profit factor, and a bootstrap CI in pandas — outside their codebase entirely.** That external recomputation simultaneously resolves circularity #2 and answers whether "no edge" is even a licensed statement.

### 9. If I had one week

Stage 1 + Stage 2, then — conditional on Stage 1 showing the parameter was never estimated — the master quantile study with residualized returns in both EW and VW, run alongside the positive control. If any factor shows a monotone spread, add MFE and the breadth experiment. That terminates the tree.

### 10. The sequence minimizing total work while maximizing certainty

```
1.  attribution.ts call site                          15m   ← may end the audit
2.  Tie handling + float equality                     10m   ← may void all IC output
3.  SQL P2 + benchmark grep + schema dump             20m   ← may void all data
4.  events/delivery study.ts                          10m
5.  Timezone grep                                      5m
    ─────────────────────────────────────────────── 1 hour
6.  Synthetic + inverse + shuffled tests               3h   ← may void all harness output
7.  Ledger export + external recompute + bootstrap CI  4h
    ─────────────────────────────────────────────── 1 day
8.  Master quantile study (only if step 1 = trade returns)  3d
9.  Positive control (parallel with 8)                      2d
10. MFE + breadth (only if step 8 monotone)                 2d
    ─────────────────────────────────────────────── 1 week
```

**Each step can terminate the sequence.** Expected total work under my current priors is closer to **one day than one week**, because there is roughly a 50% chance step 1 alone settles the A-vs-C question and a further ~25% chance steps 2–3 force Verdict D before any experiment is built.

---

*Audit position: 12 of 13 conclusions in my own Final Verdict are unverified against raw artifacts. Six circular dependencies identified in my prior reasoning, five resolvable by a single code read. The audit is complete when Stage 1 returns eight answers.*
