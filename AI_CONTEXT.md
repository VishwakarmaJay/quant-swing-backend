# AI_CONTEXT.md

**Every agent reads this before doing anything. Claude Code, Codex, and any future tool.**

---

## What this project is

A **quantitative research platform** for Indian equities. The goal is to discover, validate, and manage alpha factors over years — not to build a trading strategy. No capital is deployed. Nothing here is executed.

The unit of work is a **measured hypothesis**, not a feature or a commit.

---

## Current state

| | |
|---|---|
| Milestone | Research Platform — M1/M2 (canonical layer, vintaging) |
| Measurement layer | ✅ Validated |
| Factor library | Empty. Zero factors have cleared the bar. |
| Trial registry | ⚠️ Not yet built — **blocking all new research** |
| Feature store | ⚠️ Not yet built |
| Production signal path | Runs nightly. Frozen. Do not touch. |

---

## Established facts — do not re-litigate

**The measurement harness is correct.** Synthetic factor (= forward return) recovers IC 1.000000. Inverse recovers −1.000000. Shuffled labels give 0.000547. Two independent data controls behave as the literature predicts:

| Control | h=3 | h=5 | h=21 | h=63 |
|---|---|---|---|---|
| `momentum_12_1` | +0.022 (NW-t 3.01) | +0.027 | +0.043 | +0.060 |
| `reversal_5d` | −0.018 (NW-t −3.35) | −0.020 | −0.001 | −0.002 |

**The eight production factors contain no cross-sectional predictive information.** 810 cells measured across {raw, excess, residualized} × {EW, VW} × 6 horizons × 5 regime splits. Nothing cleared. Two were significantly wrong-signed: `momentum` (−0.016, NW-t −3.28) and `volume` (−0.016, NW-t −4.23). This question is closed. Do not re-measure them, tune them, or recombine them.

**The original research program used a non-identifying estimator.** `attribution.ts:134` correlates factor scores against `p.trade.netReturnPct` — realized return after gates, exits, portfolio caps and costs — pooled across trades rather than per-date. It measures `signal ∘ gates ∘ exits ∘ construction ∘ costs`. It is retained for historical comparability only. **Never cite its output as evidence about predictive information.**

**The failure mode this project has already experienced is *correct code implementing the wrong estimand*.** It passed typecheck, unit tests, and code review for months. Engineering review does not catch this class of error. Only scientific controls do.

---

## The bar (contract — do not weaken)

A factor is promoted only if:

```
meanIC ≥ 0.02
AND Newey-West t ≥ 3.0
AND monotone decile spread
AND holds in BOTH equal-weighted and value-weighted
AND on residualized returns (not raw, not market-excess alone)
AND incremental to the existing library (not redundant)
```

The `t ≥ 3.0` hurdle is deliberate — it is the multiple-testing threshold, not the conventional 2.0. `momentum_12_1` clears this bar at h=3, so it is achievable, not aspirational.

---

## Scientific invariants — these are CI gates, not guidelines

1. **The control suite runs on every change to the measurement path.** Synthetic must return IC ≥ 0.95, inverse ≤ −0.95, shuffled |IC| < 0.02, and both data controls must reproduce their curves. If a refactor breaks `momentum_12_1`, the build fails.
2. **Nothing runs unregistered.** Every hypothesis is written to the trial registry — mechanism, expected sign, expected horizon, bar — **before** the experiment executes. Post-hoc registration is worthless.
3. **Nulls are first-class results.** A failed hypothesis is archived identically to a successful one. It is the multiplicity denominator and the institutional memory.
4. **Realized sign is compared to pre-registered sign.** A factor that works with the wrong sign is a red flag, not a discovery.
5. **Results are immutable.** A re-run creates a new experiment. Nothing is overwritten.

---

## Architecture invariants

- **No lookahead.** Features see `candles ≤ asOf` only. Labels live in a separate store from features so feature code physically cannot read them.
- **Point-in-time only.** News as-of is `availableAt` (never `publishedAt`). Fundamentals as-of is `announcedAt` (never `periodEnd`).
- **Append-only.** Every layer. Downstream never mutates upstream.
- **Version everything.** Feature identity is `hash(code + config + input versions)`, not a filename. Renaming is free; changing logic creates a new factor that must be measured independently and cannot inherit a track record.
- **Deterministic.** No wall-clock reads, no unseeded randomness, in any factor or measurement path.
- **Frozen baseline.** `DEFAULT_STRATEGY_CONFIG` and `createProductionStrategy()` are byte-identical and stay that way. Golden fixtures are never re-baselined — a failing golden test means something broke.

---

## Known traps — read before writing any feature

| Trap | Detail |
|---|---|
| **Calendar vs trading days** | `tradeSimulator.ts:134,181` uses `dayjs(...).diff(..., 'day')` — **calendar** days. `timeStopDays: 7` ≈ 5 trading days. All new labels are in **trading days**. Every module docstring must state its convention. |
| **News structural break at 2025-01-01** | GDELT backfill has a lookback limit. Volume jumps ~300×; mean sentiment score goes −0.023 → +0.084; mean `neutralProb` 0.844 → 0.586, so average article weight `(1−neutralProb)` is **2.7× larger** after the break. Pre-2025 the factor scores filing boilerplate; post-2025 it scores media prose. Any sentiment work must split pre/post or explicitly declare it pooled across a known break. |
| **Sector is not point-in-time** | A single current-value field applied retroactively across 5 years. NSE's taxonomy drifts. This is a live lookahead in `SectorRelativeStrength` peer groups and the one-per-sector cap. Fix in the security master. |
| **Clamping destroys tail information** | Existing factors do `clamp(excess/20, ±1)` before scoring, discarding exactly the tail where information concentrates. **Store raw values alongside any transform.** |
| **Neutral-50 is not neutral** | On a 0–100 scale, 0 is maximally bearish. Absent factors must be excluded from weighted means, never coerced to 0. |
| **Float `===` tie detection** | `sectorRelativeStrengthFactor.ts:71`, `fundamentalFactor.ts:92` — ties never fire, so "tie-safe mid-rank" is actually strict rank. Order-preserving, so IC is unaffected, but the comment is wrong. |
| **`raw_capture` is empty** | B16 Bronze layer is forward-only. Every day it isn't capturing is a day of raw payloads permanently lost. |
| **Ingestion may be stalled** | `ingest_run` has 1 row against a documented 15-minute cadence. The "revisit Jan 2027" plan depends on the live tier accruing. Verify before relying on it. |

---

## Agent roles and write zones

| | Owns | Writes | Reads |
|---|---|---|---|
| **You (Head of Research)** | What problems to solve | — | Everything |
| **Codex / ChatGPT** | Literature, mechanism, methodology, specs, result interpretation | `research/**` | Everything |
| **Claude Code** | Architecture, implementation, multi-file refactors, schema, pipeline, CI | `src/**`, `prisma/**`, `research-output/` | Everything |

**Codex writes no implementation code.** Not TypeScript, not features, not harness code —
only specs, literature, throwaway analysis scripts, and critiques under `research/`. Its
full standing instruction is `AGENTS.md`. ChatGPT and Codex are the same research role on
two surfaces (uploaded CSVs vs. repo access); they share the `research/**` write zone.

When Codex is invoked read-only (the default, including every call Claude Code makes over
MCP) it cannot write. It emits file content in its response and Claude Code commits it.

**Branch discipline:** feature branches per unit of work. Research output goes on
`research/proposals-*` branches, never the branch Claude Code is on. Merge only after
typecheck, tests, **and the control suite** pass.

**Routing:** consequential changes — schema, harness, anything touching measurement — go
through the full loop (design → implement → review → interpret). A spec goes from
`research/proposals/` to Claude Code for implementation; Codex may then review the diff.

---

## Before you start

```
□ Read this file
□ Read the relevant spec in research/proposals/ if implementing a feature
□ Check the trial registry — has this hypothesis been tested before?
□ Confirm which day convention applies
```

## Before you commit

```
□ typecheck passes
□ tests pass
□ control suite passes (synthetic, inverse, shuffled, momentum_12_1, reversal_5d)
□ golden fixtures unchanged
□ no writes outside your zone
□ day convention stated in every new module docstring
□ raw values stored alongside any transformed encoding
□ trial registered before any measurement ran
```

---

## Reference

```
docs/review/QUANTSWING_MASTER_REFERENCE.md   system architecture and all math
docs/review/QUANTSWING_FINAL_VERDICT.md      why the first program produced a null
research-output/VERDICT.md                   the validated measurement result
research-output/rank_ic.csv                  810 measured cells
research-output/harness_validation.md        control suite results
```

---

*If anything in this file conflicts with a docstring, a comment, or a prior document, this file wins. If this file is wrong, fix it here first, then fix the code.*
