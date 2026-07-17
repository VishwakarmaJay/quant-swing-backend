# Research Protocol

**Every factor, strategy, and heuristic follows this pipeline. No exceptions.**

```
Hypothesis → Implement factor → Backtest → Walk-forward
→ Paper trade → Evaluate (attribution) → Promote to production
→ Monitor → Retire if degraded
```

## Hypothesis template
```
ID:            H-YYYY-NN
Claim:         <factor X improves risk-adjusted return because Y>
Prediction:    <measurable: e.g. +Z% Sharpe out-of-sample>
Test design:   <backtest window, walk-forward split, universe>
Kill criteria: <what result rejects the hypothesis>
Status:        proposed | testing | paper | production | retired
```

## Promotion criteria
- Positive contribution in out-of-sample walk-forward (not just in-sample fit)
- Improvement survives transaction costs + slippage assumption
- No degradation of existing factor set (marginal attribution positive)

## Retirement criteria
- Negative attribution over rolling 50-trade window in production
- Retired factors stay in FACTOR_CATALOG.md with post-mortem — never silently deleted

## Anti-bloat rule
If a factor doesn't improve out-of-sample performance, remove it —
even if theoretically appealing. No new indicators, filters, formulas,
or heuristics outside this protocol.

## Active hypotheses
(none yet — v1 baseline factors are grandfathered as H-0 pending first attribution cycle)
