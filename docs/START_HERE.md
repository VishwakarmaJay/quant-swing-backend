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

## Current state (Phases 1–4 + the Part-B research program complete through B9)

The **entire signal pipeline runs end-to-end, is backtested, and is deployed**:

```
OHLCV → DataQuality → 8 factors → regime → strategy (+ BULL pullback entry) → signal math
      → PortfolioManager → persist (versioned) → Telegram
```

- **Phase 1** ✅ data foundation (OHLCV — now 5.5yr/227k candles, universe of 166 equities + indices + India VIX)
- **Phase 2** ✅ factor layer — Trend, Momentum, RelativeStrength, Volume, Volatility,
  **SectorRelativeStrength** (production weight 0.25), **Fundamental** + **Sentiment** (observational)
- **Phase 2.5** ✅ golden determinism gate (byte-identical factor output in CI)
- **CI/CD** ✅ GitHub Actions (typecheck + test) + Docker → ghcr.io
- **Phase 3** ✅ decision layer: regime, strategy, signal math, portfolio, persistence, delivery
- **Phase 4** ✅ backtesting: replay engine, trade simulator, metrics, Nifty benchmark, sweep
- **Part B** ✅ portfolio-level backtest · news archive + GDELT/BSE backfills · point-in-time
  fundamentals · FinBERT sidecar · embargoed + anchored walk-forward · deployed on AWS
- **B9** ✅ joint selection → **one best strategy**: `pullback+srs0.25+ff50+sf50-novol`
  (both floor levers in, volume out), selected on all 4 coverage-era folds × both tiers
- **B11–B14** ✅ four more research lines — slot allocation, event typing, delivery %,
  horizon — **all negative** (see the read-before-planning box below)
- **B15/B16** ✅ consolidation: archive backups + offsite S3, `aliasVersion` stamping, and
  raw-payload capture (Bronze layer) — the archive now meets the factor pipeline's
  reproducibility standard. Direction: **consolidate + wait** (see [`OPEN_ITEMS.md`](./OPEN_ITEMS.md))

**473 tests pass**, `bun run typecheck` clean.

## ⚠️ The one thing you must know: still NO out-of-sample edge (but the gap is closing)

The research program has removed ~92% of the per-trade loss and, for the first time,
produced **positive absolute portfolio returns** — but the benchmark gate is still failed:

- **Signal edge (B9 stack, coverage-era OOS):** −0.04%/trade, PF 0.97 vs baseline
  −0.47/0.73 — near-breakeven, not positive.
- **Portfolio level — the decisive gate (B9):** FULL +22.8% / OOS +24.8% (maxDD −11%!)
  but vs Nifty +42.9% / +34.4%; and on the honest COVERAGE era (where the config was
  validated and the floors live): **−6.5% vs Nifty +0.8% → gate FAILED**. B1's earlier
  reading was −12.7% vs −4.4% — the gap narrowed, the verdict didn't change.

**Do NOT proceed to Phase 5 / B10 (paper trading)** — its gate is "beat Nifty
risk-adjusted, net of costs, out-of-sample." See `B9_RERUN.md` and `SYSTEM.md` §13.

## What to do next

The master tracker is [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) — trust it over this
summary. In short:

1. ~~**B7 Phase 2 — measure sentiment**~~ ✅ **done (2026-07-20)**: bucket blend rejected;
   the `sentimentFactorFloor: 50` gate is the strongest selection lever measured yet
   (+0.11 exp on the strong-evidence tier — first full-window breakeven crossing) but
   walk-forward-validated on only 1 coverage-capable fold → held observational.
   See `SENTIMENT_FACTOR.md` §4a.
2. ~~**B9 — Phase 6 rerun**~~ ✅ **done (2026-07-20)**: `pullback+srs0.25+ff50+sf50-novol`
   selected on **all 4 coverage-era folds × both tiers** (volume is out); first positive
   absolute portfolio returns (OOS +24.8%, maxDD −11%) — but on its validated era it still
   trails a flat Nifty (−6.5% vs +0.8%) → **B10 gate still failed**. See `B9_RERUN.md`.
   ⚙️ Operator decision taken (2026-07-20): **the stack IS the production config**
   (`w-68f83d8edbf9`, pinned by tests).
3. ~~**Slot-allocation research**~~ ✅ **done (2026-07-20)** — and it answered **NO**:
   no ordering (8 keys incl. sentiment/fundamental/SRS) beats a seeded **random control**
   on both windows; the incumbent composite ranking *loses* to a coin flip; widening slots
   makes it worse. ⇒ **The ~14% bottleneck is signal quality, not allocation** — a
   portfolio optimizer is premature. See `SLOT_ALLOCATION.md`.
4. ~~**Event typing for the right tail**~~ ✅ **done (2026-07-20)** — also **negative**:
   57.7% of exchange filings typed deterministically (BSE labels its own), but **no event
   type has a distinctively fat right tail** (p90 spans only 4.1–5.9 across all types), and
   the untyped `OTHER` baseline is itself positive — so the correct null is "a company
   filed something", against which only 3 of 12 types clear. `EARNINGS_RESULT` is flat:
   we can type *that* results filed, not *whether they surprised* (needs paid estimates).
   See `EVENT_STUDY.md`.
5. ⚙️ **Operator decision TAKEN (2026-07-20):** production sizing switched conviction →
   **risk** (`PORTFOLIO_SIZING_MODE`), because conviction sized capital ∝ a composite
   measured at worse-than-random. Live sizing now matches the backtested model.
6. ~~**Delivery % (NSE bhavcopy)**~~ ✅ **done (2026-07-20)** — **also negative**, and it
   was the last untouched high-ranked free source. 5.5yr archive acquired (backtestable
   today, no clock); delivery *surge* is monotone and builds with horizon but its **p90
   spread is ≈ 0 (no right tail)**, the effect ≈ trading costs, and the volume confound
   check failed. No factor built. Byproduct: delivery *level* is a clean volatility proxy.
   See `DELIVERY_STUDY.md`.

## ⚠️ Read this before planning more research

**Four independent methods now agree** (B5/B7 factor floors · B11 slot allocation ·
B12 event typing · B13 delivery %): every lever found **trims the left tail**; *nothing
identifies large winners*. B12 additionally showed we can type *that* results were filed
but never *whether they surprised* — surprise needs paid consensus estimates.

⇒ **A 2–7 day horizon on large-cap Indian equities with free data may not contain an
exploitable right tail.** Option (1), a longer horizon, has since been **tested and also
failed the gate** ([`HORIZON_STUDY.md`](./HORIZON_STUDY.md)): the right tail *does* appear
with room to run (p90 +5.3 → +16.7, PF 1.07 → 1.42) but most of that is **market beta**,
and every variant still loses to a flat Nifty on the validated era. With the mid-cap spike
(below) that is now **six** independent negatives.

⚠️ The horizon work produced **no** durable configuration: a ~30-day claim was made and
then **retracted the same day** when the walk-forward inverted it (7d incumbent is best
OOS; longer is monotonically worse — the gain was regime-specific beta). **Keep the 7-day
exit.** Remaining structural options: ~~**(2)** mid/small-cap universe~~ **TESTED 2026-07-21 →
NEGATIVE** ([`MIDCAP_SPIKE.md`](./MIDCAP_SPIKE.md)): the strategy is markedly *worse* on a
point-in-time Nifty Midcap 150 universe (loses every window, trails the segment by ~120pp);
**(3)** buy consensus estimates (unlocks the PEAD effect B12 proved we structurally cannot
see), **(4)** accept the system as decision support — a legitimate end state. Full argument:
[`DELIVERY_STUDY.md`](./DELIVERY_STUDY.md) §4 + [`HORIZON_STUDY.md`](./HORIZON_STUDY.md) §6 +
[`MIDCAP_SPIKE.md`](./MIDCAP_SPIKE.md).

> Production runs the full B9 stack (SRS 0.25 + BULL pullback entry + both floors at 50 +
> volume pruned) — the best *validated* config, **not** an edge. Plan narrative:
> `HANDOFF_NEXT_STEPS.md`.

## Where to look

| To understand… | Read |
|---|---|
| **What's left + every known limitation** | [`docs/OPEN_ITEMS.md`](./OPEN_ITEMS.md) ← open tasks & the honest limitation list |
| **What to do next, in order (live checklist)** | [`docs/ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) ← the master tracker |
| News scraper (sources, fetching, limitations) | [`docs/NEWS_SCRAPER.md`](./NEWS_SCRAPER.md) |
| **Everything in one file** (all math, all factors, findings, limitations) | [`docs/COMPLETE_REFERENCE.md`](./COMPLETE_REFERENCE.md) |
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
bun run backfill:ohlcv all 2000  # ~5.5yr history — the current research baseline

bun run factors:eval          # factor scan
bun run strategy:eval         # full pipeline preview
bun run signals:run           # nightly run (persist + deliver)
bun run backtest:run          # signal-edge replay vs Nifty
bun run backtest:portfolio    # portfolio-level "beat Nifty" gate ← the decisive one
bun run backtest:phase6       # embargoed walk-forward (OOS)
bun run backtest:slots        # slot-allocation rank keys vs a random control

bun test                      # 473 tests
bun run typecheck
```

Infra needed: PostgreSQL, Redis, RabbitMQ, and the **FinBERT sidecar** (see
[`sidecar/README.md`](../sidecar/README.md)) for sentiment scoring. Env in `.env` (see
`.env.example`). Telegram/Angel One creds are optional — the system degrades gracefully
(logs alerts, disables the live feed) when unset; a down sidecar leaves articles unscored
and the next run catches up.

Deployed on one EC2 box — see [`DEPLOYMENT_AWS.md`](./DEPLOYMENT_AWS.md). ⚠️ It is a
burstable t3.small: **run CPU-heavy backtests and imports on a workstation**, not the VM.

## Conventions (important)

- **Determinism is sacred**: factors are pure (no clock/random/env inside `evaluate`);
  timing is attached by the runner. Any factor change that shifts a number **fails the
  golden test** — re-baseline with `bun run golden:update` and justify it.
- **Every numeric is config**, not a literal in business logic.
- **Every rejection has a reason** (persisted in `signal_rejection`).
- Runtime knobs are **env vars** (e.g. `PORTFOLIO_BASE_CAPITAL`, `PORTFOLIO_MAX_OPEN_POSITIONS`).
- **Point-in-time is sacred too**: the as-of date is the date *we could have known it* —
  `availableAt` for news, `announcedAt` for fundamentals. Never `publishedAt`, never
  period-end. Backfilled rows carry a reconstructed `availableAt`, so evaluate per-`origin`.
- **New factors land observational** (empty bucket / weight 0), keeping the baseline
  byte-identical; they graduate only on walk-forward evidence. `DEFAULT_STRATEGY_CONFIG`
  stays **frozen** as the research control — production config lives in
  `src/strategy/productionStrategy.ts`.
- **Nothing is believed off a single window.** Grid-picked configs must be OOS-validated;
  this project has been burned by in-sample optimism more than once.
