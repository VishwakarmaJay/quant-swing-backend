# System Pipeline

## Nightly Deep Run (16:00 IST)
1. **Load universe** — Nifty 500 → volume > 5L, price ₹50–2000, not T2T/BE/Z → ~150 stocks
2. **Fetch OHLCV** — daily incremental (1 candle/stock); throttled 3 req/sec ≈ 50s
3. **Data quality gate** — continuity, staleness, malformed records; score < 0.8 → skip stock
4. **Feature extraction** — all registered Factors evaluate → immutable FeatureBundle
5. **News pipeline** — RSS pull → title normalize → Jaccard dedup → India-term normalizer
   → FinBERT scoring → chase-penalty decay → per-stock aggregate
6. **Regime detection** — Nifty vs EMA200, breadth (EMA50 %, 52W hi/lo), VIX → BULL/SIDEWAYS/BEAR/CRASH
7. **Strategy** — WeightedStrategy: regime weights + 7 gates → TradeCandidates
8. **PortfolioManager** — kill switch, position limit (2), sector cap (1), sizing → ApprovedSignals + Rejections
9. **Persistence** — snapshot JSONB + version fields + regime
10. **Delivery** — explainable Telegram alert; failure → undelivered queue with retry

## Intraday checks (11:00, 13:30, 15:15)
Open positions only: SL proximity, thesis-break (2 closes < EMA20, MACD flip,
sentiment < −0.5) → HOLD / WATCH / EXIT alert.

## Pre-market (08:45)
Overnight news on open positions, gap risk, regime refresh.

## CRASH override
Nifty Δ < −3% or VIX > 30 or circuit → no new signals; exit checks only.
