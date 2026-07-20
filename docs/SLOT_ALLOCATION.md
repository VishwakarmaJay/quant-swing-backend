# B11 — Slot-allocation research (the ranking question, answered)

> **Run it:** `bun run backtest:slots [live|live+bse|all]` (read-only).
> **Code:** `src/backtest/portfolioSimulator.ts` (`RankKey`, regret metrics) +
> `src/scripts/runSlotAllocation.ts`. **Date:** 2026-07-20 · **Tier:** `live+bse`.
> Tracker: [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) B11 · precedent:
> [`B9_RERUN.md`](./B9_RERUN.md) §4 (which named this the largest unworked lever).

## 1. The question and the pre-registered rule

B1/B9 measured the bottleneck: the 2-slot book takes **~14%** of signals, and *which*
14% is decided by ranking on the composite — a score Step-1 proved has ρ≈0 with outcomes.
Before building any portfolio optimizer, the cheap prior question had to be answered:
**does any ordering available to us beat a coin flip?**

**Rule fixed before the run:** a key earns further work only if it beats the seeded
`random` control on `selEdge` across **both** windows.

**`selEdge`** (the metric this study turns on) `= mean net% of trades TAKEN − mean net% of
candidates SKIPPED for want of a slot`. Both sides are already precomputed by the
simulator, so regret costs nothing to measure. It isolates the ordering's own contribution
from the tape: ≈0 means the key carries no information, whatever the headline return does.

Method: the production strategy is replayed **once** (3,050 signals); every cell re-runs
only the book simulation, so the candidate pool is identical throughout and differences
are allocation alone. `random` is FNV-1a-seeded on (symbol, entryDate) — deterministic
across runs, uncorrelated with any factor.

## 2. Result — nothing beats the coin flip

`selEdge` per key (2 slots, risk sizing):

| rank key | COVERAGE 2024-07→ | FULL 2021-11→ | verdict |
|---|---|---|---|
| **random (control)** | **−0.01** | **+0.05** | the bar |
| composite (incumbent) | −0.14 | +0.03 | **loses to random on both** |
| fundamental | **+0.14** | −0.06 | wins one, loses one → fails the rule |
| srs | −0.01 | −0.28 | fails |
| agreement | −0.08 | −0.27 | fails |
| sentiment | −0.15 | −0.15 | fails |
| calm (low-ATR) | −0.33 | −0.49 | **actively harmful** |
| tight-stop | −0.37 | −0.47 | **actively harmful** |

**No key passes.** `fundamental` is the only one to beat random anywhere (+0.14 on the
coverage era) and it reverses on the full window — the single-window pattern this project
has been burned by twice before, which is exactly why the rule demanded both.

Three findings sharper than the headline:

1. **The incumbent composite ranking is *worse than random* on both windows.** Not merely
   uninformative — mildly anti-informative (−0.14 vs −0.01; +0.03 vs +0.05). The live
   PortfolioManager orders slots by this score.
2. **`calm` and `tight-stop` are consistently, strongly harmful** (−0.33/−0.37 and
   −0.49/−0.47). That *is* information, inverted: preferring the calmest, tightest-stop
   candidates systematically selects worse trades. Worth remembering as a "don't", not a
   lever.
3. **On the FULL window the book's skipped trades were, on average, *better than the ones
   it took*** for six of eight keys (skip% +0.11…+0.20 vs taken% −0.29…+0.16). The ρ≈0
   result reproduced from the allocation side, by an independent method.

## 3. Slots dose — width does not rescue it either

| slots | composite ret% / selEdge | random ret% / selEdge |
|---|---|---|
| 2 | −1.68 / −0.14 | +2.53 / −0.01 |
| 3 | +0.09 / −0.02 | −4.08 / −0.03 |
| 4 | −3.02 / −0.05 | −7.66 / −0.12 |
| 6 | −14.79 / −0.38 | −7.45 / −0.07 |

Widening slots **makes things worse, monotonically past 3**. This is the expected
behaviour of a *negative-expectancy candidate pool*: taking more of it compounds the drift
instead of diversifying it away. It closes the "just raise `maxOpenPositions`" hypothesis.

## 4. What *did* replicate: risk sizing dominates

Every one of the 12 sizing cells on the coverage window favours risk sizing, by large
margins in both return and drawdown:

| key | flat | conviction | **risk** |
|---|---|---|---|
| composite | −16.31 (DD −26.9) | −13.59 (−22.7) | **−1.68 (−10.1)** |
| random | −7.70 (−30.1) | −8.45 (−25.4) | **+2.53 (−11.5)** |
| sentiment | −18.30 (−34.3) | −15.48 (−27.6) | **−3.93 (−15.5)** |
| calm | −26.65 (−29.9) | −20.56 (−23.4) | **−13.56 (−15.4)** |

Note the mechanism: **conviction sizing allocates capital in proportion to the composite**
— the score just shown to be worse than random. It sizes up on a coin flip's losing side.
Risk sizing (fixed % of equity at risk) is indifferent to the uninformative score and
halves the drawdowns. This corroborates B9's independent finding.

## 5. ⚠️ The one number not to believe

`random` + risk sizing + 2 slots returned **+2.53% vs Nifty +0.80%** on the coverage
window — nominally "beating the benchmark". **This is not an edge and must not be reported
as one.** Its `selEdge` is −0.01: the ranking contributed nothing, so the return came from
the tape plus sizing, over n=180 trades. It is precisely the kind of single-cell artifact
that the pre-registered rule and the `selEdge` metric exist to neutralize. Recording it
here so it cannot be rediscovered later and mistaken for a result.

## 6. Verdict

1. **The pre-registered rule returns NO.** No available ordering beats a coin flip on both
   windows ⇒ **the ~14% bottleneck is signal quality, not allocation.**
2. **A portfolio optimizer is premature and is not the next project.** Its objective
   function (expected return per candidate) does not yet exist — that is the same ρ≈0 hole,
   restated. Building constrained optimization on top of a ranking that loses to random
   would optimize noise. This experiment cost a day and redirected a month.
3. **The bar for any future ranking work is now explicit:** beat the seeded random control
   on `selEdge`, on both windows, before anything is built on top of it. The control and
   the metric are permanent fixtures of the simulator.
4. **Two actionable outputs**, both matters for the operator:
   - ⚙️ **Sizing:** production uses *conviction* sizing (capital ∝ composite). The evidence
     across B9 and B11 says **risk sizing** is the better default in both return and
     drawdown. Changing it is an operator decision (`PORTFOLIO_*` env knobs).
   - The composite's role in *ranking* and *sizing* is now measured as ≤ random. It should
     not be given more responsibility until something has predictive power.
5. **Where the effort should go instead:** the right tail. Everything measured so far —
   both floors, all eight rank keys — trims the left tail or does nothing. Nothing yet
   identifies *large winners*. That points at event-typed data (results/orders/ratings,
   already flowing through the BSE pipe and labelled by the exchange) and delivery %,
   rather than any re-weighting of the existing scores.

## 7. Caveats

Single ₹2L base and n≈175–200 taken trades per coverage cell — headline returns are
sequencing-sensitive, which is why `selEdge` (per-trade, n≈700 skipped as the comparison
set) is the reported statistic. Survivorship (today's constituents); fixed cost model;
trade paths independent of the book (no market impact); one flat-market coverage era plus
one mixed full window. `random` is one seed — a multi-seed band would sharpen the control,
though the failures here are not close enough for that to change the verdict.
