# B14 — Longer horizon (option 1): refuted out-of-sample

> **Run it:** `bun run backtest:horizon` (signal-edge sweep) ·
> `backtest:horizon:portfolio` (beta-inclusive gate) · `backtest:horizon:wf` (the
> walk-forward that decided it). Read-only.
>
> ⚠️ **Read §4 before §2.** §2's headline result is a bull-market artifact; the
> walk-forward inverts it, and a claim made in the first draft of this doc is retracted.
> **Code:** `src/backtest/tradeSimulator.ts` (horizon-scoped exits) ·
> `src/scripts/{runHorizonSweep,runHorizonPortfolio,runHorizonWalkForward}.ts`. **Date:** 2026-07-20 · 448 tests.
> Motivated by [`DELIVERY_STUDY.md`](./DELIVERY_STUDY.md) §4 option 1.

## 1. Why a longer horizon, and the trap that nearly hid the answer

Four studies (B5/B7 floors, B11 allocation, B12 events, B13 delivery) found levers that
trim the left tail and nothing that finds large winners at 2–7 days. But **every drift
signal that did appear — ORDER_WIN, RATING_ACTION, delivery surge — was strongest at the
longest horizon measured (10d)**. The data was pointing at the exit, not the entry.

**The trap:** the thesis-break rule (`2 closes below EMA20 || MACD histogram flip`) is a
*7-day thesis*. Over 30–60 days nearly every name trips it, so it — not `timeStopDays` —
becomes the binding exit. Raising the time stop alone leaves holding periods **unchanged**
and reports "longer horizons don't help" for entirely the wrong reason.

This is now pinned by test (`tradeSimulator.test.ts`): a 45-day time stop yields *identical*
holding days to a 7-day one. `closesBelowEmaExit` and `macdFlipExit` are configuration;
the defaults reproduce every previously published result exactly. The sweep includes
deliberate **"naive" control rows** so the trap is visible in the output:

| control | time stop | **actual avg hold** |
|---|---|---|
| 21d naive | 21d | **8.0d** |
| 45d naive | 45d | **8.6d** |

## 2. Signal-edge result — the right tail finally appears

Production config, deep window, 3,147 signals, exits varied only:

| variant | avg hold | exp% | PF | **p90** | win% | exit mix (stop/T1/T2/time/thesis) |
|---|---|---|---|---|---|---|
| 7d (incumbent) | 4.6d | +0.10 | 1.07 | +5.30 | 41.9 | 638/144/1350/1011/4 |
| 21d scaled | 12.7d | +0.31 | 1.14 | +8.82 | 38.1 | 1493/134/1194/316/10 |
| 30d scaled | 16.4d | +0.43 | 1.18 | +10.47 | 35.7 | 1776/204/922/230/15 |
| 45d scaled | 21.3d | +0.55 | 1.20 | +12.74 | 31.1 | 1960/202/723/244/18 |
| 60d trend-only | 24.4d | +0.97 | 1.37 | +15.29 | 27.1 | 1745/57/603/724/18 |
| **90d trend-only** | **28.3d** | **+1.12** | **1.42** | **+16.68** | 26.0 | 1766/114/303/946/18 |

Monotone in every column. **p90 rises +5.30 → +16.68** — the right tail four studies failed
to find was there all along; the 7-day exit was amputating it. Win rate falling (41.9% →
26.0%) while expectancy rises is the textbook trend-following signature.

**Taken alone this looks like the breakthrough. It is not.**

## 3. The confound, and the portfolio gate that settles it

Signal-edge expectancy is **absolute** net return, not excess over benchmark. Nifty
compounded +42.9% over this window (~0.027%/trading day), so a 20-trading-day hold
mechanically collects **~+0.5% of pure beta** versus ~+0.09% for a 3-day hold — roughly
half the apparent gain, before any skill.

The portfolio simulator settles it, because Nifty B&H sits on the same side of the ledger:

### FULL window (2021-11 → 2026-07)
| variant | sizing | ret% | maxDD% | expo% | trades |
|---|---|---|---|---|---|
| 7d incumbent | risk | +4.72 | −19.3 | 33 | 472 |
| 30d scaled | risk | +11.14 | −14.3 | 43 | 174 |
| **60d trend-only** | **flat** | **+52.16** | **−46.6** | **87** | 123 |
| 90d trend-only | flat | −16.78 | −52.1 | 86 | 109 |
| **NIFTY B&H** | — | **+42.92** | | | |

### COVERAGE window (2024-07 → 2026-07 — the validated era)
| variant | sizing | ret% | maxDD% | trades |
|---|---|---|---|---|
| 7d incumbent | risk | −13.00 | −18.3 | 192 |
| **30d scaled** | **risk** | **−7.89** | **−13.8** | 80 |
| 60d trend-only | risk | −12.57 | −22.6 | 58 |
| 90d trend-only | risk | −18.08 | −21.4 | 53 |
| **NIFTY B&H** | — | **+0.80** | | |

**Every variant loses to a flat Nifty on the validated era.** The gate fails again.

### The one cell that "beat Nifty" is leveraged beta, not alpha
`60d trend-only / flat` returned +52.2% vs Nifty's +42.9% on the FULL window — and it
should not be believed for three independent reasons:
1. **87% average exposure.** It is essentially always fully invested. Beating the index by
   9pp while permanently long is not alpha; it is the index with extra steps.
2. **−46.6% max drawdown** against Nifty's own far shallower path. Risk-adjusted, it loses
   badly — and the gate is explicitly "beat Nifty **risk-adjusted**".
3. **It reverses on the validated era**: the same config returns **−30.6%** on COVERAGE.
   The single-window/single-sizing reversal is the exact in-sample optimism pattern that
   has caught this project twice before.

**⇒ The beta hypothesis is confirmed.** The signal-edge improvement was substantially the
mechanical result of longer market exposure, and it does not survive a same-units comparison.

## 4. ⛔ RETRACTION — the walk-forward reversed this section (added same day)

**This section originally claimed `30d scaled + risk sizing` was "a real relative
improvement". That claim is withdrawn.** It was based on the portfolio COVERAGE row
(−7.89% vs the incumbent's −13.00%) from a single window. The anchored walk-forward
(`bun run backtest:horizon:wf`, 4 folds, embargo 60d ≥ the longest horizon tested) says
the opposite, monotonically:

| config (fixed, concatenated OOS) | trades | win% | exp% | PF |
|---|---|---|---|---|
| **7d incumbent** | 1008 | 41.1 | **−0.09** | **0.94** |
| 21d scaled | 1008 | 34.2 | −0.45 | 0.81 |
| 30d scaled | 1008 | 30.7 | −0.63 | 0.75 |
| 45d scaled | 1008 | 24.8 | −0.76 | 0.73 |
| 60d trend-only | 1008 | 22.2 | −0.79 | 0.72 |
| walk-forward selected | 1008 | 22.2 | −0.79 | 0.72 |

**Out-of-sample the ordering is exactly inverted from §2.** Longer holds are monotonically
*worse*; the 7-day incumbent is the best exit configuration tested.

**The selection mechanism was itself fooled**, which is the most instructive part:
`60d trend-only` was chosen on **all four** train windows (they include the 2021–24 bull
run, where it looks superb) and then lost on **every** unseen test window — −1.22, −0.98,
−0.15, −0.79. A grid-picked horizon does not generalize.

### Why the portfolio row misled me
30d took **80 trades where 7d took 192**. Each trade was *worse* out-of-sample; there were
simply fewer of them, so less total damage compounded. The portfolio "advantage" was
**trading less**, not trading better — and trading less is achievable directly, without a
horizon change. Mistaking a lower trade count for a better lever is the specific error
recorded here.

### The refined mechanism
§3 attributed the sweep's gains to beta. The walk-forward sharpens that: it is
**regime-specific** beta. The full window contains Nifty's +42.9% run, where long holds
collect drift; the coverage era is flat (+0.8%), where long holds merely hold losers
longer. The horizon effect is a bull-market artifact, not a property of the signal set.

## 5. Verdict

1. **The horizon hypothesis is refuted out-of-sample.** The single-window sweep's monotone
   improvement (PF 1.07 → 1.42) inverts under walk-forward (PF 0.94 → 0.72). The right
   tail seen in §2 is real *in a bull tape* and does not generalize.
2. **Nothing from B14 is adopted, and nothing survives as a lever** — including the 30d
   claim this doc originally made and now retracts (§4).
3. **The 7-day incumbent exit is vindicated** as the best of everything tested, which is a
   genuine (if unglamorous) result: the existing configuration was not leaving money on
   the table at the exit.
4. **B10 stays hard-gated.** Fifth consecutive negative on beating the benchmark.
5. **Method note — the third time an OOS check has reversed a single-window conclusion**
   in this project (after Step-4b pullback-v2 and the original Phase 6). The standing rule
   earned its keep again: *nothing is believed off one window.* The harness gap that made
   this checkable at all — `WFCandidate` could vary entries but not exits — was closed as
   part of this work.

## 6. Where this honestly leaves the program

The remaining structural options from `DELIVERY_STUDY.md` §4 have not improved:
**(2) mid/small-cap universe** — untested, and the most plausible remaining free-data
avenue since large caps are the most efficiently priced segment; **(3) paid consensus
estimates** — would unlock the PEAD effect B12 proved we structurally cannot see;
**(4) accept the system as decision support** — a reproducible, honestly-measured signal
factory with a validated least-bad config, which is a legitimate end state.

What B14 adds to that choice: **nothing about horizon should be carried forward.** The
earlier draft of this doc recommended a ~30-day horizon; the walk-forward retracted it
(§4). Keep the 7-day exit. The durable output of B14 is not a configuration but two pieces
of infrastructure — horizon-scoped exit config (with the thesis-break trap pinned by test)
and a walk-forward harness that can now validate exits as well as entries.

## 7. Caveats

Signal-edge rows are absolute returns (the beta issue this doc exists to expose) — the
portfolio table is the comparable one. Single window, no walk-forward on the horizon
variants: they are hypotheses, not validated configs. Survivorship (today's universe).
Longer holds interact with the 2-slot cap in ways only the portfolio simulator captures,
and n falls to ~53 trades on the coverage window, so those cells are sequencing-sensitive.
The sweep varies exits only — entries are the unchanged production config.
