# Known Limitations

1. **Survivorship bias** — backtests use a static universe; historical constituent DB
   unavailable. Results are optimistic. Every report carries this stamp.
2. **No sentiment in backtests** until ~6 months of self-built news archive exists.
3. **FinBERT is US-trained** — India normalizer + overrides mitigate; residual
   misreads possible until fine-tuned on Indian corpus.
4. **Fixed-bps slippage assumption** until live fill data accumulates.
5. **agreementScore is uncalibrated** — factor agreement, not statistical confidence.
6. **First-order news mapping only** — dictionary misses second-order effects.
   *(Moot today: no Sentiment factor is built yet — see FACTOR_CATALOG.md.)*
7. **Manual execution delay** — human latency between alert and order is untracked
   slippage vs paper results.
8. **Single-user, single-node by design** — multi-user is out of scope.
9. **Transaction cost drag** — 3× cost rule mitigates low-payoff trades.
   *[AS-BUILT: base capital is ₹100,000/trade, not ₹5,000 — proportional drag is now small.]*
10. **Angel One dependency** — limits/SDK verified at build time; subject to change.
