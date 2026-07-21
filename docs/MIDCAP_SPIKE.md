# Option-B spike — Nifty Midcap 150 (2026-07-21)

> **Go/no-go question:** does the existing (large-cap-tuned) B9 strategy show ANY edge on a
> mid-cap universe, *before* investing in midcap news/fundamentals/live infra? **Answer: a
> strong NO.** The strategy loses money on midcaps in every window and underperforms the
> midcap segment by ~120pp — it is markedly *worse* down-cap, not better. This is the sixth
> independent negative on "beat the benchmark."
>
> Run it: `bun run midcap:ingest` then `bun run midcap:spike` (read-only).

## 1. The result
B9 stack (production config: `pullback+srs0.25+ff50+sf50-novol`), risk sizing, ₹2L book:

| window | **B9 strategy** | **Midcap-EWI B&H** (the bar) | Nifty B&H (ref) |
|---|---|---|---|
| FULL (2021-11→) | −24.98% | **+104.15%** | +42.92% |
| OOS (2023-01→) | −23.00% | **+94.92%** | +34.39% |
| COVERAGE (2024-07→) | −21.14% | **+6.34%** | +0.80% |

- The **fair bar is the midcap segment**, not Nifty: beating Nifty-50 with midcaps in a bull
  tape is just beta. The midcap segment returned **+104%** (survivorship-correct equal-weight,
  point-in-time — consistent with the real Nifty Midcap 150 index roughly doubling over the
  window).
- The strategy **lost money in every window** and trailed the segment by ~120pp (FULL/OOS),
  ~28pp (COVERAGE). It also lost to a flat Nifty.
- Mechanism: at ~25% exposure with tight ATR stops and a pullback entry, the config captures
  almost none of the +100% beta while paying the volatility. **But the −120pp is largely an
  exposure/beta confound** — a concentrated 2-slot book *cannot* track a 100%-invested basket in
  a +104% tape by construction, so "trails the equal-weight segment" overstates the selection
  failure. The fair, exposure-independent read is the walk-forward below.

## 1a. The fair test — signal-edge walk-forward (`backtest:phase6 --midcap`)
Letting the harness **select** among 8 configs per fold (3 embargoed folds), judged on per-trade
net % (no 2-slot cap → exposure-neutral):

| | test n | OOS exp% | PF |
|---|---|---|---|
| walk-forward **selected** | 1078 | **−0.04** | **0.98** |
| baseline (control) | 1204 | −0.09 | 0.95 |

Per-fold picks churn (baseline +0.41/1.27, then srs0.25 −0.59/0.71, then the stack −0.04/0.97) —
no config generalizes. **The decisive fact:** midcap OOS per-trade edge is **−0.04% / PF 0.98 —
essentially identical to large-caps (−0.04 / PF 0.97, B9).** So at the signal level the strategy
is **no better down-cap, not markedly worse** — the same near-breakeven-negative it is
everywhere. The "inefficiency is likelier down-cap" thesis is refuted either way: down-cap offers
**no improvement**.

## 2. Method (what makes this a fair, honest test)
- **Universe:** the **2021-03 Nifty Midcap 150 cohort** (150 names → 141 with bhav data), a
  *fixed point-in-time cohort* — sidesteps entry-timing look-ahead (names only exit, never
  enter mid-window). Committed snapshots in `data/midcap/` (Wayback + current).
- **Survivorship-correct:** each name's candles are bounded to its index-exit date (±1
  reconstitution), so decliners/delistings stay in during their membership and drop out after.
- **Data:** OHLCV from the B13 bhavcopy archive, ingested as `instrumentType: 'EQ_MID'` (id
  `MID:<sym>`) so `loadCandleStore` ignores it unless asked (`universeType`) — every large-cap
  backtest is untouched. Sectors normalized across NSE's drifting taxonomy (`midcapSectors.ts`).
- **Corp-action adjustment — a real fix landed here.** Midcaps split/bonus often, and NSE
  bhavcopy's `PREV_CLOSE` is the **raw** (unadjusted) prior close (verified: NAUKRI's 1:5 split
  ex-date shows `PREV_CLOSE 6984.50` next to `OPEN 1387.50`). The old `backAdjustSplits`
  compared PREV_CLOSE to the prior row's close and so **missed every split** (NAUKRI −80%, SRF
  −81% fake crashes). Rewrote it to use the gap-robust per-row **`PREV_CLOSE / OPEN`** ratio
  (= 5.03 for NAUKRI) — now adjusts 11 names correctly; series verified continuous.
- **Benchmark:** RS factor + regime keep Nifty (market-wide); the comparison bar is the
  point-in-time equal-weight midcap B&H, computed in the spike.

## 3. Caveats (and what a full Option-B program would still need)
- **Technicals-only.** No midcap news/fundamentals, so the ff50/sf50 floors read neutral-50 and
  pass — the effective strategy is `pullback+srs0.25−volume`. Building midcap sentiment +
  fundamentals is exactly the investment this cheap spike was meant to gate, and the gate says
  don't.
- **Config not re-tuned for midcaps.** This applies the *large-cap-selected* config as-is. A
  fair "could ANY config find midcap edge" test would re-run attribution + the anchored
  walk-forward + floor selection on the midcap universe. But starting −120pp behind the
  segment, with a long-only trend/pullback style that is structurally whipsawed by midcap
  volatility, the odds of re-tuning flipping it are low.
- **±1-reconstitution windows**, fixed 2021 cohort (excludes later entrants — conservative),
  equal-weight (not cap-weight) benchmark. None of these threaten a 120pp verdict.

## 4. Verdict
**Option B is not supported.** The fair signal-edge test (§1a) shows the strategy is **no better
on midcaps than large-caps** — OOS per-trade −0.04% / PF 0.98, near-breakeven-negative on both —
refuting the "free-data inefficiency is likelier down-cap" thesis. (The portfolio-level −120pp of
§1 is real but largely an exposure/beta confound, not uniquely-bad midcap selection.) Combined
with the five prior negatives and B12's
structural result (free data can't see earnings surprise), the evidence continues to point at
**Option A (consolidate + wait)** or **Option D (accept as decision support)** rather than a
mid/small-cap pivot. Reopening B would mean a full midcap-specific research program (its own
attribution + walk-forward + a midcap news/fundamentals build) against a 120pp deficit — a hard
sell. The reusable tooling (bhavcopy→OHLCV with correct split adjustment, point-in-time
universe ingest, `universeType` scoping) is now in place if that is ever undertaken.
