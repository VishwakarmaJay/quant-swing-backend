# System Pipeline

> ⚠️ **STALE SPEC — the as-built pipeline is nightly-only.** The **news/FinBERT step (5)**, the
> **intraday checks**, and the **pre-market run** are **not implemented**. As-built cron: 08:00
> instrument sync · 16:30 OHLCV incremental · **17:00 nightly signal run** → persist → Telegram.
> [`../../SYSTEM.md`](../../SYSTEM.md) §1 & §10 is authoritative; see
> [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) §3.

## Nightly Deep Run (as-built: **17:00 IST**; spec said 16:00)
1. **Load universe** — committed reference set of **166 NSE equities** + 3 indices
2. **Fetch OHLCV** — daily incremental (1 candle/stock); throttled 3 req/sec *(16:30 cron)*
3. **Data quality gate** — continuity, staleness, malformed records; score < 0.8 → skip stock
4. **Feature extraction** — all registered Factors evaluate → immutable FeatureBundle
5. ~~**News pipeline** — RSS → dedup → FinBERT → aggregate~~ *[NOT BUILT — no Sentiment factor yet]*
6. **Regime detection** — Nifty vs EMA200, breadth (EMA50 % only), VIX *(or Nifty ATR% proxy)* → BULL/SIDEWAYS/BEAR/CRASH/HIGH_VOL
7. **Strategy** — WeightedStrategy: regime weights + 7 gates → TradeCandidates *(composite = technical only today)*
8. **PortfolioManager** — kill switch, position limit (2), sector cap (1), conviction sizing → ApprovedSignals + Rejections
9. **Persistence** — snapshot JSONB + version fields + regime
10. **Delivery** — explainable Telegram alert; failure → undelivered queue with retry

## ~~Intraday checks (11:00, 13:30, 15:15)~~  *[NOT IMPLEMENTED]*
Spec intent — open positions only: SL proximity, thesis-break (2 closes < EMA20, MACD flip,
sentiment < −0.5) → HOLD / WATCH / EXIT alert. **Not built** (no intraday job runs).

## ~~Pre-market (08:45)~~  *[NOT IMPLEMENTED]*
Spec intent — overnight news on open positions, gap risk, regime refresh. **Not built.**

## CRASH override
Nifty Δ < −3% or VIX ≥ 30 → no new signals; exit checks only. *(as-built; evaluated at the 17:00 run)*
