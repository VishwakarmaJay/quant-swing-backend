# Assumptions & Known Limitations (research honesty ledger)

1. **Survivorship bias** — static universe in backtests; results optimistic. Documented on every report.
2. **FinBERT US training** — Indian terms handled via normalizer + overrides; residual misreads possible until fine-tuned.
3. **Slippage model** — fixed bps assumption until live fill data exists.
4. **agreementScore ≠ confidence** — uncalibrated heuristic until 100+ outcomes.
5. **Sentiment backtests** — impossible until ~6 months of news archive accumulates.
6. **Second-order news effects** — dictionary mapping catches first-order only; missed second-order costs opportunities, not money.
7. **Starting weights/thresholds are heuristics** — every numeric is a backtest-tunable config, not a claim.
8. **Transaction-cost drag** — the min-return rule (3× cost) guards against low-payoff trades. *[AS-BUILT: base capital is now ₹100,000/trade, not the spec's ₹5,000, so proportional cost drag is far smaller than this assumption originally feared.]*
9. **Angel One dependency** — rate limits and SDK behavior verified at build time, may change.
10. **Manual execution** — human delay between signal and order introduces untracked slippage vs paper results.
