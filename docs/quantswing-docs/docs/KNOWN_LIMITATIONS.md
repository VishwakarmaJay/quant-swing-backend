# Known Limitations

1. **Survivorship bias** — backtests use a static universe; historical constituent DB
   unavailable. Results are optimistic. Every report carries this stamp.
2. **No sentiment in backtests** until ~6 months of self-built news archive exists.
3. **FinBERT is US-trained** — India normalizer + overrides mitigate; residual
   misreads possible until fine-tuned on Indian corpus.
4. **Fixed-bps slippage assumption** until live fill data accumulates.
5. **agreementScore is uncalibrated** — factor agreement, not statistical confidence.
6. **First-order news mapping only** — dictionary misses second-order effects
   (accepted: those are low-conviction trades at this capital anyway).
7. **Manual execution delay** — human latency between alert and order is untracked
   slippage vs paper results.
8. **Single-user, single-node by design** — multi-user is out of scope.
9. **Transaction cost drag at ₹5K** is proportionally heavy; 3× cost rule mitigates,
   doesn't remove.
10. **Angel One dependency** — limits/SDK verified at build time; subject to change.
