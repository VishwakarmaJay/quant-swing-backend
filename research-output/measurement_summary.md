# Task 8 — Measurement Summary

Full window: 2021-01-27 → 2026-07-17 · universe 177 · panel rows 190543.

Rank IC is unweighted (Spearman). Bar: `meanIC ≥ 0.02 AND neweyWestTStat ≥ 3.0` on ALL-dates. Newey-West lags = horizon.

## Cells clearing the bar

**None.** No `(subject, labelType, horizon)` cleared `meanIC ≥ 0.02 AND NW-t ≥ 3.0` in any variant.

## Interpretation rule

- Nothing clears the bar in any variant → the features contain **no cross-sectional predictive information**.
- Anything clears in **both EW and VW on residualised returns** (mono high, CI excludes 0) → **signal exists**, proceed to Task 9.
- A cell that clears only in `fwd`/`xs` but collapses under `resid`/VW is likely a beta or size artifact, not alpha.
