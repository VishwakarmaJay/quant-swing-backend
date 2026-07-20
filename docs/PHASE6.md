# Phase 6 — combine + walk-forward evaluation

> **[SUPERSEDED for current state — B9, 2026-07-20]** This doc records the original 2-year
> 2×2-grid run. The definitive joint evaluation (anchored coverage-era folds, 8-candidate
> grid incl. both floors + volume pruning, portfolio gate) is [`B9_RERUN.md`](./B9_RERUN.md).
> The numbers below remain the honest record of what was known at the time.

> **Run it:** `bun run backtest:phase6` (read-only; needs the ~2yr backfill).
> **Harness:** `src/backtest/walkForward.ts` (reusable) + `src/scripts/runPhase6.ts`.

## Why
Steps 3 (sector-relative RS) and 4b (BULL pullback+resumption entry) each looked positive on a single
window and faded out-of-sample. Phase 6's job is to (a) build the **reusable walk-forward** harness the
project kept needing, and (b) use it to answer honestly: does *combining* the levers, with the config
**selected on train and measured on unseen test**, beat the baseline out-of-sample — and is it edge?

## Method
- **Walk-forward, expanding window, 3 folds** over the tradeable range. Each fold: score every
  candidate on its train window, pick the best by net expectancy, measure that pick on the unseen test
  window; concatenate the test folds for a true out-of-sample result.
- **Candidate grid:** {SRS composite weight 0 / 0.25} × {BULL entry: buy-strength / pullback+resumption}.
  The two levers compose without new code: `BullPullbackStrategy(pullbackV2, WeightedStrategy(withSRS))`.
- **Control:** the baseline strategy held fixed across the same test windows (no selection).

## Result

Per fold, the combined `pullback+srs0.25` was selected **every time** (stable, not config churn):

| test window | selected | test n | test exp | PF |
|---|---|---|---|---|
| 2025-07 → 2025-11 | pullback+srs0.25 | 234 | −0.31 | 0.76 |
| 2025-11 → 2026-03 | pullback+srs0.25 | 227 | −0.16 | 0.87 |
| 2026-03 → 2026-07 | pullback+srs0.25 | 223 | +0.11 | 1.07 |

Out-of-sample (concatenated test folds):

| strategy | trades | win% | expectancy | PF |
|---|---|---|---|---|
| **walk-forward selected (combined)** | 684 | 40.9 | **−0.12** | **0.91** |
| baseline (control) | 789 | 39.5 | −0.34 | 0.78 |

Nifty B&H over the OOS window (2025-07 → 2026-07): **−4.43%** (a flat/down market period).

## The honest reading
- **The combined levers robustly beat the baseline out-of-sample.** PF 0.78 → 0.91, expectancy
  −0.34 → −0.12 (about a third of the per-trade loss removed), win rate up. And the winning config is
  selected on *all three* folds — the improvement is stable across time, not a single-window fluke.
  This is the first result that is *both* an improvement *and* validated out-of-sample.
- **But it is still not a positive edge.** OOS expectancy is −0.12, PF 0.91 < 1 — the strategy still
  loses per trade on unseen data. The levers cut the loss; they do not cross into profit.
- **⇒ Phase 5 (paper trading) stays gated.** The gate is "beat Nifty risk-adjusted"; a strategy with
  negative OOS expectancy cannot clear it. (The most recent fold was positive — PF 1.07 — but one
  fold is not an edge.)
- **On "beat Nifty":** not claimable here. Per-trade net % is *signal-edge* (every signal taken, no
  2-position cap), so cumulative and B&H % are not directly comparable — a real beat-Nifty test needs
  portfolio-level simulation. And more fundamentally, you can't beat a benchmark with negative edge.

## On "learned weighting" (the spec's Phase-6 vision)
Deliberately **not** a GBM/logistic model yet. Step-1 showed the composite features carry ρ≈0
discrimination, and Steps 3/4b showed how badly single-window fits flatter — a learned model on these
features would be premature and overfit-prone. The responsible Phase-6 step is walk-forward *config
selection* (a light, honest form of learning) plus the reusable harness. ML weighting stays future
work, gated on (a) more/orthogonal signal for it to learn from, and (b) this walk-forward harness to
keep it honest.

## What Phase 6 delivered
1. **A reusable walk-forward harness** (`makeExpandingFolds`, `runWalkForward`) — the evaluation
   infrastructure the project repeatedly needed; anything can now be scored out-of-sample.
2. **A validated combined strategy**: SRS weight + BULL pullback+resumption entry beats baseline OOS
   (PF 0.91 vs 0.78), stably across folds.
3. **An honest verdict**: real, validated progress, but **no positive edge yet** — the remaining gap
   almost certainly needs *orthogonal* signal (the Fundamental factor, still data-blocked), not more
   technical-entry tuning. Phase 5 remains correctly gated.

## Caveats
Technicals-only; survivorship bias (today's constituents); signal-edge (no 2-position cap); 3 folds
over ~2yr is a short walk-forward; the grid is small (2×2). Directionally trustworthy; not a
live-trading performance estimate.
