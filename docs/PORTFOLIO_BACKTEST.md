# B1 — Portfolio-Level Backtest (the fair "beat Nifty" gate)

> **Run it:** `bun run backtest:portfolio` (read-only; needs the ~2yr backfill).
> **Code:** [`src/backtest/portfolioSimulator.ts`](../src/backtest/portfolioSimulator.ts)
> (pure, 8 unit tests) + [`src/scripts/runPortfolioBacktest.ts`](../src/scripts/runPortfolioBacktest.ts).
> Tracker: [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) B1.

## Why this exists
The signal-edge replay takes **every** signal with no caps — its additive cumulative % was
never comparable to Nifty B&H (different units). This simulator runs **one ₹2,00,000 book**
(live: ₹100k × 2 slots) through the signal stream in calendar order with the real
constraints — 2-position limit, 1-per-sector cap, cash, sizing, kill switch — and produces a
daily mark-to-market equity curve: **CAGR, true max drawdown, exposure, in the same units as
the benchmark.** The B10 paper-trading gate now reads *this* report.

**Mechanics** (honest and conservative): trade trajectories are precomputed with the same
`simulateTrade` as the signal-edge pass (identical fills/costs/exits); the portfolio pass
decides which trades are taken and how large. Entries execute at the open **before**
same-day exits (a freed slot waits a day — no lookahead). Partial exits sell whole shares.
Kill switch blocks next-day entries after a ≥5%-of-equity realized-loss day.

## Results (2-year backfill; 1× costs = 5bps slip + 0.05%/side)

### FULL window (2025-03-03 → 2026-07-17)

| strategy | sizing | final | ret% | CAGR% | maxDD% | expo% | trades | win% |
|---|---|---|---|---|---|---|---|---|
| baseline | flat | ₹1,86,975 | −6.51 | −4.79 | −26.4 | 71 | 141 | 41.1 |
| baseline | conviction | ₹1,88,016 | −5.99 | −4.40 | −22.8 | 58 | 141 | 41.1 |
| baseline | risk | ₹1,83,583 | −8.21 | −6.05 | −14.4 | 37 | 141 | 41.1 |
| combined | flat | ₹1,93,348 | −3.33 | −2.44 | −26.0 | 65 | 146 | 41.1 |
| **combined** | **conviction** | **₹1,95,884** | **−2.06** | **−1.50** | −20.6 | 51 | 146 | 41.1 |
| combined | risk | ₹1,86,622 | −6.69 | −4.92 | −18.2 | 36 | 146 | 41.1 |
| **NIFTY B&H** | — | **₹2,20,020** | **+10.01** | | | | | |

### OOS window (2025-07-07 → 2026-07-17 — the Phase-6 test stretch)

| strategy | sizing | final | ret% | CAGR% | maxDD% | trades | win% |
|---|---|---|---|---|---|---|---|
| baseline | flat | ₹1,53,120 | −23.44 | −22.91 | −28.9 | 111 | 38.7 |
| baseline | conviction | ₹1,62,677 | −18.66 | −18.22 | −23.7 | 111 | 38.7 |
| baseline | risk | ₹1,70,467 | −14.77 | −14.41 | −15.6 | 111 | 37.8 |
| combined | flat | ₹1,61,874 | −19.06 | −18.62 | −22.4 | 114 | 36.8 |
| **combined** | **conviction** | **₹1,74,512** | **−12.74** | **−12.43** | −18.8 | 114 | 36.8 |
| combined | risk | ₹1,72,671 | −13.66 | −13.33 | −14.6 | 114 | 36.8 |
| **NIFTY B&H** | — | **₹1,91,140** | **−4.43** | | | | |

### Cost stress (OOS, 2× slippage + commissions, flat sizing)
baseline −30.83% · combined −27.58% → **ranking stable** (combined still beats baseline);
both degrade ~7pp — the strategies are cost-sensitive but the *ordering* is not cost-fragile.

## The findings

1. **The portfolio truth is worse than the signal-edge truth.** Signal-edge OOS said
   −0.12%/trade (PF 0.91, near-breakeven). The portfolio lost **−12.7% to −23.4%** OOS while
   Nifty lost only −4.4%. Two compounding reasons:
   - **The 2-slot book takes only ~15% of signals** (position-limit skips ≈670–830) — and
     *which* 15% is decided by composite ranking, which Step 1 proved uninformative (ρ≈0).
     The cap turns a mild per-trade edge deficit into concentrated sequencing risk.
   - **Compounding on one capital base** — with ~65% average exposure, a negative per-trade
     drift compounds into a deep equity drawdown instead of averaging out across 684
     equal-weight trades.
2. **The gate is now real — and currently failed by a wide margin.** Both windows, every
   sizing, both cost levels: the strategy trails Nifty B&H. This was always true; now it is
   *measured in the same units* instead of obscured by the additive curve.
3. **The relative lever survives at portfolio level.** Combined beats baseline in **every**
   sizing mode, both windows, and at 2× costs (best: conviction −12.74% vs baseline flat
   −23.44% OOS). The Phase-6 result generalizes from signal space to portfolio space.
4. **Sizing effects:** risk-based sizing delivers the smallest drawdowns (−14.6% vs −22.4%
   flat) via lower exposure — the right default for capital preservation. Conviction sizing
   scored best on return here, but with n≈114 trades and an uninformative composite, treat
   that as variance, not vindication.
5. **A new lever surfaced: slot allocation.** With only ~15% of signals takeable, *the
   ranking that picks them* matters as much as the signals themselves. Ranking by something
   with actual predictive value (none exists yet — see Step 1) or relaxing
   `maxOpenPositions` are now measurable experiments via this simulator.

## Implications
- **B10 gate status: FAILED (as expected).** No paper trading. The gap to close is not
  "−0.12 to 0" per trade — at portfolio level it's ≈8–19pp/yr vs the benchmark.
- Reinforces the standing conclusion: the remaining gap needs **orthogonal signal** (B4→B5
  fundamentals first), not more tuning of the technical levers.
- When new factors land, **evaluate them through this simulator too** — signal-edge PF is
  necessary, portfolio CAGR vs Nifty is decisive.

## Caveats
Survivorship bias (today's constituents); fixed cost model; trade paths independent of the
book (no market impact); entries-before-exits ordering (conservative); single ₹2L capital
base; OOS window is one ~12.5-month stretch of one market cycle.
