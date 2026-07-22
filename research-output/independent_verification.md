# Task 11 — Independent Recomputation

Purpose: break the circular dependency in which the project's headline metrics are
validated only by the project's own TypeScript. `research-output/verify.py` is
standalone pandas/numpy — it imports **no** project code — and recomputes the B9
signal-edge metrics from `ledger_b9_full.csv`.

The ledger is the B9 stack (`pullback+srs0.25+ff50+sf50-novol`) on the **anchored
OOS concat** (anchor 2024-07-01, 4 embargoed folds, `live+bse` tier) — the exact
construction behind `docs/B9_RERUN.md`'s reported figure.

## Recomputed vs reported

| Metric | Reported (project TS) | Recomputed (standalone pandas) | Match |
|---|---|---|---|
| trades | — | 912 | — |
| **expectancy** (mean net %/trade) | **−0.04** | **−0.0402** | ✅ exact |
| **profit factor** | **0.97** | **0.9701** | ✅ exact |
| win rate | — | 40.79% | — |
| gross return sum | — | −36.67% | — |

The project's expectancy and profit-factor computations are **confirmed correct** —
independent code on the same ledger reproduces them to 4 significant figures. This
closes the circular-dependency concern: the −0.04 / 0.97 numbers are real, not an
artifact of the measurement code.

## Stationary block bootstrap (block ≈ 20, 10,000 reps, seeded)

| Statistic | Point | 95% CI | Spans the null? |
|---|---|---|---|
| expectancy | −0.0402 | **[−0.3995, +0.3480]** | **spans 0 widely** (width 0.75 pp) |
| profit factor | 0.9701 | [0.734, 1.285] | spans 1.0 |

## Interpretation — the decisive point

> **The 95% CI on expectancy is [−0.40, +0.35]. It spans zero widely.** From the
> trade ledger alone, *neither* "the strategy has a per-trade edge" *nor* "the
> strategy has no edge" is a licensed conclusion.

This is exactly the `[−0.30, +0.20]`-style outcome the evidence request (§ST5)
flagged as decisive. The 912-trade sample is **underpowered**: the per-trade
expectancy estimator cannot distinguish a small negative edge from a small positive
one at 95% confidence.

**This is the correct diagnosis of the ORIGINAL project error.** The project's
`ρ≈0` and `−0.04% expectancy` come from a *trade-return* estimator whose sampling
distribution is this wide — it is non-identifying for the question that matters.
It is *not* evidence for "no edge"; it is evidence that this estimator cannot
answer the question.

The question is instead answered by the **cross-sectional measurement** (Task 8),
which uses a properly-identifying estimator (per-date rank IC on forward returns)
validated by Gate A (deterministic) and Gate B (recovers momentum + reversal). See
`VERDICT.md` — the trade-ledger CI and the cross-sectional IC are two different
estimands, and only the second is identifying.
