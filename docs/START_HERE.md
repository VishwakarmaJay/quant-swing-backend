# START HERE — onboarding for a new session

Read this first, then [`SYSTEM.md`](./SYSTEM.md). This is the fast orientation for
picking up QuantSwing in a fresh Claude Code session.

---

## What this project is

A **deterministic, explainable quant decision-support system** for Indian equities (NSE).
It scans ~166 stocks nightly and produces ranked, gated, risk-sized **trade signals** with
a full reproducibility trail, delivered to Telegram. Orders are placed **manually** — it is
decision support, not an execution bot.

- **Backend** (this repo): Bun + TypeScript + Express + Prisma/PostgreSQL + Redis + RabbitMQ.
- Live at `git@github.com:VishwakarmaJay/quant-swing-backend` (pushed over HTTPS via `gh`).
- Frontend is a separate repo (`quant-swing-frontend`).

## Current state (Phases 1–4 complete)

The **entire signal pipeline runs end-to-end and is backtested**:

```
OHLCV → DataQuality → 5 factors → regime → WeightedStrategy → signal math
      → PortfolioManager → persist (versioned) → Telegram
```

- **Phase 1** ✅ data foundation (historical OHLCV, universe of 166 equities + 3 indices, nightly update)
- **Phase 2** ✅ 5 factors: Trend, Momentum, RelativeStrength, Volume, Volatility
  (+ **SectorRelativeStrength** added later — built, observational/weight-0 pending Phase 6)
- **Phase 2.5** ✅ golden determinism gate (byte-identical factor output in CI)
- **CI/CD** ✅ GitHub Actions (typecheck + test) + Docker → ghcr.io
- **Phase 3** ✅ decision layer: regime, strategy, signal math, portfolio, persistence, delivery
- **Phase 4** ✅ backtesting: replay engine, trade simulator (5 exit triggers), metrics, Nifty benchmark, parameter sweep

**112 tests pass**, `bun run typecheck` clean.

## ⚠️ The one thing you must know: the backtest says NO edge yet

Over **~16 months / 981 trades**: profit factor **0.86**, expectancy **−0.22%/trade**,
loses to Nifty (+10%). The **parameter sweep proves all 16 exit configs lose** → **the
problem is the entries, not the exits.** The strategy currently runs on **4 technical
factors only** (Sentiment + Fundamental not built; their weight-buckets renormalize out).

**Do NOT proceed to Phase 5 (paper trading)** — its gate is "beat Nifty," which the
backtest already fails. See `SYSTEM.md` §7.5 and §13.

## What to do next (recommended order)

1. ~~**Sector-relative RS**~~ ✅ **built** (observational, weight 0) — the deferred half of
   RelativeStrength. Selection test shows it improves backtested expectancy (−0.22 → −0.13) as an
   orthogonal filter; weight deferred to Phase 6. See `ATTRIBUTION.md`.
2. **Fundamental factor** (Screener/NSE) — backtestable orthogonal signal (Step-1 attribution says
   favour orthogonal over more trend factors).
3. **Sentiment factor** (FinBERT) — start the news archive now (can't backtest until ~6mo of it).
4. **Phase 6** — factor pruning + joint learned weighting (this is where the SRS weight gets set),
   using the Phase 4 backtest + attribution harness to measure what actually has edge.

> ⚠️ The backtest still shows **no net edge** (see below) — do these to *build* edge; Phase 5
> (paper trading) stays gated until a backtest beats Nifty. Plan detail: `HANDOFF_NEXT_STEPS.md`.

## Where to look

| To understand… | Read |
|---|---|
| **The whole system + all the math** | [`docs/SYSTEM.md`](./SYSTEM.md) ← the authoritative doc |
| Original spec / planning / ADRs | [`docs/quantswing-docs/`](./quantswing-docs/) (project, engineering, research, planning) |
| Factors + indicators (pure math) | `src/factors/` |
| Regime / strategy / signal math / portfolio | `src/regime/`, `src/strategy/`, `src/signal/`, `src/portfolio/` |
| Persistence + versioning | `src/pipeline/` |
| Delivery (Telegram) | `src/delivery/` |
| **Backtesting + the finding** | `src/backtest/` |
| DB schema | `prisma/schema.prisma` |

## How to run it

```bash
bun install
bun run prisma:deploy         # migrations
bun run sync:instruments      # universe from Angel One
bun run backfill:ohlcv all 800   # ~2yr history (needed for a real backtest)

bun run factors:eval          # factor scan
bun run strategy:eval         # full pipeline preview
bun run signals:run           # nightly run (persist + deliver)
bun run backtest:run          # historical performance vs Nifty
bun run backtest:sweep        # parameter sensitivity

bun test                      # 112 tests
bun run typecheck
```

Infra needed: PostgreSQL, Redis, RabbitMQ (all on localhost). Env in `.env`
(see `.env.example`). Telegram/Angel One creds are optional — the system degrades
gracefully (logs alerts, disables the live feed) when unset.

## Conventions (important)

- **Determinism is sacred**: factors are pure (no clock/random/env inside `evaluate`);
  timing is attached by the runner. Any factor change that shifts a number **fails the
  golden test** — re-baseline with `bun run golden:update` and justify it.
- **Every numeric is config**, not a literal in business logic.
- **Every rejection has a reason** (persisted in `signal_rejection`).
- Runtime knobs are **env vars** (e.g. `PORTFOLIO_BASE_CAPITAL`, `PORTFOLIO_MAX_OPEN_POSITIONS`).
