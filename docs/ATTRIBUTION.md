# Step 1 — Factor & Gate Attribution (findings)

> **Run it:** `bun run backtest:attribution` (read-only; needs the ~2yr backfill).
> **Code:** [`src/backtest/attribution.ts`](../src/backtest/attribution.ts) (pure stats, unit-tested)
> + [`src/scripts/runAttribution.ts`](../src/scripts/runAttribution.ts) (report).
> **Window measured:** 167 stocks · 544 trading days · **981 trades** — the same set behind the
> headline finding, so this decomposes *that* result rather than a different one.

## Why this was Step 1
The backtest proved the entries have no edge, but no one had measured **which** factor or gate is
responsible. `RESEARCH_PROTOCOL.md` demands out-of-sample attribution before promotion, yet all 4
technical factors were grandfathered in untested. This is the cheapest analysis that most changes
what we do next — done entirely on the existing Phase-4 harness, no new factors built.

## Method
Two complementary views, both on the live signal set:
1. **Conditioning** — reproduce the exact 981 signals, capture each one's factor / composite /
   agreement scores + regime, then correlate those with the trade's realised net return
   (Spearman + terciles). *Does a higher score predict a better trade?*
2. **Leave-one-out ablation** — disable each gate, and drop each factor from the composite, one at
   a time; regenerate + re-simulate; compare to baseline. *What is each part's marginal edge?*

Baseline reproduced exactly: **win 41.3% · expectancy −0.22%/trade · PF 0.86**.

---

## Finding 1 — nothing discriminates winners from losers
Spearman(score, net return) for every decision input, over the 981 trades:

| feature | Spearman | read |
|---|---|---|
| trend | +0.008 | flat (noise) |
| momentum | −0.058 | flat, slightly inverted |
| relativeStrength | −0.012 | flat |
| volume | +0.002 | flat |
| volatility | +0.048 | weak: calmer stocks slightly better |
| **composite** | **−0.018** | **flat — the conviction score does not predict outcome** |
| agreement | +0.014 | flat |

Every correlation is ≈ 0 (|ρ| < 0.06). The terciles confirm it — expectancy does **not** rise from
the low-score to the high-score third for any feature; it wanders. **The composite is the headline:
the score that ranks conviction and drives position sizing is uninformative about returns.** More
composite ≠ better trade, so conviction-based sizing is allocating more capital to trades that are
not actually better.

> Caveat: conditioning is range-restricted — every trade already cleared the gates, so scores span a
> narrow band. It measures marginal discrimination *within* the selected set, not standalone power.
> Findings 2–3 (ablation, regime) are **not** range-restricted and carry the weight.

## Finding 2 — the scoring gates are mostly inert; only RSI does real work
Disable one gate, re-measure (a gate has **positive edge** if disabling it *lowers* expectancy):

| disabled gate | signals | expectancy | PF | Δ expectancy | Δ signals |
|---|---|---|---|---|---|
| regime | 981 | −0.22 | 0.86 | +0.00 | +0 |
| composite | 1229 | −0.22 | 0.86 | +0.00 | **+248** |
| technical-floor | 981 | −0.22 | 0.86 | +0.00 | +0 |
| macd-bullish | 1588 | −0.26 | 0.83 | −0.03 | +607 |
| price-above-ema20 | 1028 | −0.25 | 0.84 | −0.03 | +47 |
| **rsi-band** | 1730 | **−0.39** | 0.77 | **−0.16** | +749 |

- **composite ≥ threshold is inert**: it admits 248 more trades when removed, all at the *same*
  −0.22 expectancy. The threshold isn't selecting better trades — it just selects *fewer*.
- **technical-floor and regime never bind** in this window (0 delta).
- **rsi-band (35–68) is the only gate with real edge** — removing it admits 749 clearly worse
  trades (−0.39). macd-bullish and price-above-ema20 help marginally.
- But even the best-gated configuration stays at −0.22. **Gates trim the losing tail; they cannot
  manufacture edge that the entries lack.**

## Finding 3 — the losses are concentrated in BULL regime *(the most actionable result)*

| regime | trades | win% | expectancy | PF |
|---|---|---|---|---|
| SIDEWAYS | 534 | 45.3 | **+0.02** | 1.01 |
| **BULL** | **397** | **36.0** | **−0.67** | **0.61** |
| BEAR | 38 | 36.8 | −0.08 | 0.96 |
| HIGH_VOL | 12 | 50.0 | +3.16 | 5.49 |

**SIDEWAYS is ~breakeven; BULL is where the money is lost** (PF 0.61 over 397 trades — a large,
trustworthy sample). This is the "buys extended uptrends that then chop" thesis, localized: in a
strong tape the strategy buys the *most* extended trend-strength names right as they mean-revert.
(HIGH_VOL's +3.16 is only 12 trades — noise, ignore.)

## Finding 4 — factor contributions: trend carries, volume hurts
Drop one factor from the composite (a factor **contributes** if dropping it lowers expectancy):

| dropped factor | expectancy | Δ expectancy | verdict |
|---|---|---|---|
| trend | −0.37 | **−0.14** | best contributor — removing it hurts most |
| relativeStrength | −0.29 | −0.07 | mild positive contributor |
| momentum | −0.22 | +0.00 | contributes nothing |
| **volume** | −0.20 | **+0.02** | **mildly harmful — dropping it helps** |

Ordering: trend > relativeStrength > momentum ≈ 0 > volume (slightly negative). All effects are
small (≤0.14) and **no configuration reaches positive expectancy** — consistent with four
correlated trend/momentum factors that all lean the same way.

---

## Conclusion → this hits the HANDOFF decision gate
> HANDOFF Step 1: *"if nothing in the current set shows edge, the **entry style itself** (buying
> trend strength) is the problem — which reframes Steps 3–4."*

That is what the data says:
1. No factor and not the composite discriminates outcomes (Finding 1).
2. The scoring gates are largely inert — only the RSI band filters; the composite threshold and
   technical floor earn nothing (Finding 2).
3. The negative expectancy is **structural and regime-linked**: buying trend strength loses in BULL
   and is breakeven in SIDEWAYS (Finding 3).
4. The factors are a low-diversity trend/momentum cluster; the best of them (trend) still can't lift
   expectancy above zero (Finding 4).

**Implication for the roadmap:** adding two more *lagging, trend-aligned* signals (the original
Step 4 instinct) is unlikely to fix a problem that is about entry *style*. The evidence points to:
- **Genuinely orthogonal signal** — Fundamental (value/quality, uncorrelated with trend) and
  sector-relative RS (cross-sectional, not just "is it going up") are more likely to add edge than
  another momentum-family factor. This *raises* the priority of Step 3 (sector-relative RS) and the
  **Fundamental** half of Step 4, and *lowers* the expected payoff of piling on more trend factors.
- **Regime-conditioned entries** — the strategy should probably not buy the most extended names in
  BULL. Worth testing: a mean-reversion / pullback entry in BULL, or de-emphasising trend strength
  when breadth is already euphoric.
- **Drop or fix volume** — it is currently a (mild) drag; pruning beats adding.
- **The conviction score needs rebuilding, not reweighting** — since composite ρ ≈ 0, hand-tuning
  weights won't help. This is the Phase-6 (learned weighting) argument, but only *after* an
  orthogonal signal exists for it to learn from.

---

## Addendum (Step 3) — SectorRelativeStrength: conditioning vs selection
When the sector-relative factor was built (observational, weight 0), the harness measured it two ways
— and they disagreed, which is the instructive part:

- **Conditioning** (does it re-rank the existing 981 trades?): Spearman **−0.018**, terciles flat.
  No — but this is range-restricted (those trades were already trend-selected; SRS didn't pick them).
- **Selection** (`2c` — give it composite weight, regenerate, does it pick *better* stocks?):

  | SRS weight | signals | win% | expectancy | PF | Δ exp |
  |---|---|---|---|---|---|
  | 0 (baseline) | 981 | 41.3 | −0.22 | 0.86 | — |
  | 0.15 | 906 | 42.6 | −0.15 | 0.90 | +0.07 |
  | **0.25** | 856 | **43.5** | **−0.13** | **0.92** | **+0.10** |
  | 0.40 | 819 | 43.1 | −0.15 | 0.90 | +0.07 |

  **Yes** — adding it improves every metric by dropping ~125 sector-laggard trades before they fire.
  The concave response (peaks at ~0.25) is the signature of real signal, not noise. It's the **first
  orthogonal signal that measurably helps** — validating the Step-1 "add orthogonal, not more trend"
  call. Still net-negative (PF 0.92 < 1): an improvement to keep and build on, not a fix.

**Lesson:** conditioning tests *re-ranking*; only the selection test (change what's picked) reveals a
factor's value as an entry filter. Trusting conditioning alone would have wrongly discarded SRS.
**The weight is deferred to Phase 6** (joint learned weighting) rather than hand-set now.

## Caveats (stamped on every run)
Technicals-only; survivorship bias (today's constituents); signal-edge (no 2-position cap);
conditioning is range-restricted (see Finding 1). Directional conclusions (ablation, regime) are
robust to these; absolute expectancy is not a live-trading estimate.
