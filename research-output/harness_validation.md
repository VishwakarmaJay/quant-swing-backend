# Gate A — Harness Validation (STOP GATE)

Deterministic properties of a correct per-date rank-IC harness. **A failure here
is always a bug, never a market fact** — a harness that cannot recover a signal
it was handed cannot support any conclusion (Task 6, Gate A).

Implemented in `src/research/harness.test.ts`, run on a **seeded** synthetic
panel (300 dates × 50 symbols, deterministic) using the exact production
`rankIC` (`src/research/rankIC.ts`), which reuses the verified tie-averaged
`spearman` from `src/backtest/attribution.ts`.

## Result — all three PASS

| Test | Injected factor | Required | Measured `meanIC` | Verdict |
|---|---|---|---|---|
| **T1 Synthetic** | factor = `fwd5` | `≥ 0.95` | **1.000000** (nDates=300) | ✅ PASS |
| **T2 Inverse** | factor = `−fwd5` | `≤ −0.95` | **−1.000000** | ✅ PASS |
| **T3 Shuffled** | composite; `fwd5` shuffled within each date | `|meanIC| < 0.02` | **0.000547** | ✅ PASS |

**Interpretation.** The harness (a) recovers a perfectly-aligned signal at IC=1,
(b) recovers a perfectly-inverted signal at IC=−1, and (c) returns IC≈0 when the
cross-sectional score↔label link is destroyed by within-date shuffling. The
date-grouping, rank-correlation wiring, and averaging are therefore correct. No
stop condition fired; work proceeds to Gate B (data control) and Task 8.

> Note: T1/T2/T3 are properties of the *estimator*, independent of the data
> distribution. They will be re-run on the **real composite panel** during Task 8
> and appended here, to confirm the same wiring on production-shaped scores.
