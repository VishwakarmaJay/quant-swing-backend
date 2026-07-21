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
- Mechanism: at ~25% exposure with tight ATR stops and a pullback entry, the config is
  whipsawed by midcap volatility (**win rate 31–38%** vs 40%+ on large-caps), capturing almost
  none of the +100% beta while paying the noise. It is not "no edge down-cap" — it is
  **structurally worse** down-cap.

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
**Option B is not supported by the cheap test.** The current strategy is *worse* on midcaps,
not better — refuting the "free-data inefficiency is likelier down-cap → a strategy could find
edge there" thesis *for this strategy*. Combined with the five prior negatives and B12's
structural result (free data can't see earnings surprise), the evidence continues to point at
**Option A (consolidate + wait)** or **Option D (accept as decision support)** rather than a
mid/small-cap pivot. Reopening B would mean a full midcap-specific research program (its own
attribution + walk-forward + a midcap news/fundamentals build) against a 120pp deficit — a hard
sell. The reusable tooling (bhavcopy→OHLCV with correct split adjustment, point-in-time
universe ingest, `universeType` scoping) is now in place if that is ever undertaken.
