# B9 — Phase 6 rerun: joint selection over the enriched factor set

> **Run it:** `bun run backtest:phase6 [tier] [--from YYYY-MM-DD] [--folds N]` ·
> `bun run backtest:portfolio [tier]` (read-only; needs the deep backfill + synced archive).
> **Date:** 2026-07-20 · **Tier of record:** `live+bse` (strongest availability evidence).
> Tracker: [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) B9 · precedents:
> [`PHASE6.md`](./PHASE6.md) (original), [`FUNDAMENTAL_FACTOR.md`](./FUNDAMENTAL_FACTOR.md) (B5),
> [`SENTIMENT_FACTOR.md`](./SENTIMENT_FACTOR.md) §4a (B7).

## 1. Why a rerun, and the fold-design fix

All factors are now built and individually measured (B5 fundamental, B7 sentiment — both
floor-mechanism levers). But the deep-window walk-forward leaves archive-dependent levers
expressible on only the LAST fold: candles run from 2021-11, the archives from
2024-01/2025-01, so on earlier folds the floors pass everything neutral — a structurally
unfair test (the B7 Phase 2 finding).

**Fix: anchored folds** (`makeAnchoredFolds`, +2 tests). Test era anchored at
**2024-07-01** (6 months after BSE filing coverage starts) and split into **4 embargoed
folds**; train still expands from warmup over all history. Both designs were run, on both
informative tiers, with one deliberate 8-candidate grid: three controls (baseline /
srs0.25 / pullback+srs0.25), each floor alone (+ff50 / +sf50), the stack (+ff50+sf50),
and — jointly tested for the first time since Step-1 flagged it — volume pruned
(`-novol`, alone and stacked).

## 2. Walk-forward result — the first stable multi-fold winner

**`pullback+srs0.25+ff50+sf50-novol` was selected on all 4 anchored folds × both tiers
(8/8)** — the first uniform selection since `pullback+srs0.25` won the original 3 folds:

| anchored fold (test) | `live+bse` exp / PF |
|---|---|
| 2024-07→2025-01 | −0.28 / 0.82 |
| 2025-01→2025-07 | +0.79 / 1.69 |
| 2025-07→2026-01 | −0.18 / 0.84 |
| 2026-01→2026-07 | −0.15 / 0.91 |
| **OOS concat** | **−0.04 / 0.97** vs baseline control **−0.47 / 0.73** |

- ~92% of the per-trade loss removed vs baseline over an era where Nifty went nowhere
  (+0.8% over 2 years) — but still marginally negative. Signal edge: near-breakeven.
- **Volume is out.** `-novol` appears in every anchored winner and 2 of 3 deep-fold
  winners; no selected config anywhere kept it. Step-1's suspicion, jointly confirmed.
- Evidence hierarchy holds: `live+bse` OOS (−0.04/0.97) > `all` (−0.09/0.94) — the
  anti-artifact ordering, again. Deep folds independently re-picked the same stack on
  their only coverage-capable fold (+0.15/1.13; the B7 run had +0.14/1.12).

## 3. Portfolio gate (`backtest:portfolio live+bse`, B9 stack added)

One ₹2L book, 2-slot cap, 1-per-sector, kill switch; FULL / OOS(2023-01→) /
**COVERAGE(2024-07→**, the era the stack was validated on); 3 sizings; 2× cost stress.

| window | best stack row (sizing) | Nifty B&H | verdict |
|---|---|---|---|
| FULL 2021-11→ | **+22.8%** (flat) · maxDD −11.4 (risk) | +42.9% | trails |
| OOS 2023-01→ | **+24.8%** (flat), +22.8% (risk, maxDD −11.3) | +34.4% | trails |
| **COVERAGE 2024-07→** | **−6.5% (risk, maxDD −11.1)** | **+0.8%** | **trails — GATE FAILED** |

- **First positive absolute portfolio returns in the project's history** (FULL and OOS
  windows), and the best drawdown profile ever measured (−11% maxDD at ~30% exposure,
  zero kill-switch days). The stack beats every other config on every window, every
  sizing, and the ordering is stable at 2× costs.
- **But the B10 gate reads the honest window, and it still fails.** On the coverage era —
  the only stretch where the floors were live and the config was walk-forward-validated —
  the stack loses −6.5% (best case) against a flat Nifty. Closest approach yet
  (B1: −12.7 vs −4.4), still a fail. No paper trading.
- **Caveat on the flattering FULL/OOS rows:** pre-2024 the floors pass everything
  (neutral) and the config degenerates to `pullback+srs0.25-novol` — so those windows
  partly measure a different, weaker config in a friendlier tape. The coverage row is the
  one that measures the actual stack.
- Cost stress: everything degrades hard at 2× (stack −25.7 → −37.6 flat) — the
  strategies remain cost-sensitive; only the *ordering* is robust.

## 4. Verdict

1. **One best evaluated strategy exists** — `pullback+srs0.25+ff50+sf50-novol` — with
   every component earning its place under joint selection (and volume earning its
   removal). Uniform across folds, tiers, and fold designs.
2. **B10 stays hard-gated.** Negative return on the validated era vs a flat benchmark.
   The remaining gap at portfolio level: roughly 4–10pp/yr depending on window.
3. **Operator decision — TAKEN (2026-07-20): the stack is production.** It beat the prior
   production config on every window × sizing × cost level in this report;
   `createProductionStrategy()` now builds it, `weightsVersion` → **`w-68f83d8edbf9`**,
   pinned by `productionStrategy.test.ts`. Signals remain manual decision support.
4. **Where the remaining gap points:** the 2-slot book takes ~14% of signals
   (position-limit skips ≈ 709/178 taken on coverage), still ranked by a composite with
   ρ≈0. **[B11 UPDATE, same day: measured and closed.](./SLOT_ALLOCATION.md)** No ordering
   beats a seeded random control on both windows — the incumbent composite ranking *loses*
   to a coin flip, and widening slots degrades monotonically. The bottleneck is signal
   quality, not allocation; a portfolio optimizer is premature.
   Risk sizing consistently delivers the smallest drawdowns and the best coverage-era
   result — the capital-preservation default.

## 5. Caveats

Survivorship (pre-2024 constituent history still unsourced — B8.2 residual, open);
coverage era = one ~2yr flat-market stretch (no bull-tape validation of the floors —
they were inert in the 2023 bull window); reconstructed `availableAt` on backfilled rows
(mitigated by the live+bse tier of record and the anti-artifact ordering); fixed cost
model; sf50's article stream is ~52% uncovered names passing as neutral. Sentiment
Spearman is still ≈0 — the working levers are tail-trims, not rankings; learned
weighting stays deferred.
