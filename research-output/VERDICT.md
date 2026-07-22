# VERDICT

## Answer: **A — the features contain no cross-sectional predictive information**

…detectable at a pre-registered bar (`meanIC ≥ 0.02 AND Newey-West t ≥ 3.0`) by a
harness independently validated to *be able* to detect signal. Stated precisely:
across the composite and all 8 factors, over label variants {raw, market-excess,
residualized}, weightings {EW, VW}, horizons {1,3,5,10,21,63}, and splits
{ALL, BULL, BEAR, SIDEWAYS, HIGH_VOL} — **nothing clears the bar in any of the 810
IC cells.**

This is **not** a restatement of the project's original `ρ≈0`. That figure came
from a non-identifying estimator (factor score vs *realized post-exit trade
return*). This verdict rests on the identifying estimator the project never
computed — per-date cross-sectional rank IC of factor scores against *forward
returns* — validated end-to-end.

---

## Why A, and why not D or B

### The harness can detect signal — so a null is meaningful (rules out D)

| Control | Result | Meaning |
|---|---|---|
| **Gate A · synthetic** (factor = fwd5) | meanIC **1.000** | wiring recovers a perfect signal |
| **Gate A · inverse** (factor = −fwd5) | meanIC **−1.000** | recovers a perfect inversion |
| **Gate A · shuffled** (labels shuffled within date) | |meanIC| **0.0005** | returns ~0 when the link is destroyed |
| **Gate B · 12-1 momentum** | meanIC **+0.013 → +0.060** (NW-t up to 3.0, deciles 78% monotone) | recovers the canonical anomaly, right sign |
| **Gate B · 5-day reversal** | meanIC **−0.012** at h1 (NW-t −2.9) | recovers short-term reversal, right sign |

The instrument recovers a deterministic injected signal *and* two real, independent,
oppositely-signed market anomalies. Data integrity is clean (`price_audit.txt`: 0
duplicate keys; 9 open-price glitches on one day; 24 economically-genuine >20% moves;
no options/flow/pledge tables). The B9 metrics reproduce **exactly** under standalone
pandas (`independent_verification.md`). **The infrastructure is trustworthy — D is
ruled out.**

### The production features carry no detectable cross-sectional information (supports A)

From `rank_ic.csv` (ALL-dates):

- **Highest significance:** `volatility · resid · h1` at NW-t **3.74** — but meanIC
  **0.011**, far below the 0.02 economic bar. One marginal cell in 810 tests is
  expected by chance under multiplicity (Harvey-Liu-Zhu t>3 hurdle); economically
  negligible (rank IC 0.011 ≈ nil explanatory power).
- **Largest IC:** `fundamental · resid · h63` at meanIC **0.028** — but NW-t only
  **1.32** (long overlapping windows → few independent obs). Not significant.
- **Composite:** flat. EW D10−D1 spreads look positive and grow with horizon
  (`quantile_spread.csv`: h21 **+1.07%**, h63 **+2.55%**) but **collapse under
  value-weighting** (h63 VW **−0.32%**) and vanish in residual space (composite
  resid VW ≈ 0 to slightly negative at every horizon). Textbook small-cap/beta
  artifact (audit H-4/H-5), not alpha.
- **sectorRelativeStrength** (the audit's prime suspect): small spreads, similar EW
  and VW (~+0.31% at h21 both), NW-t < 1.5 — no edge.
- **Production `momentum` factor:** mildly **wrong-signed** in residual space
  (`momentum · resid · h5` NW-t **−3.28**, meanIC −0.016) — MACD/RSI short-term
  momentum mean-reverts; economically tiny but if anything it detracts.

The production features are **weaker than a single textbook control** run through the
same harness (12-1 momentum cleared meanIC 0.06 at NW-t 3.0; nothing here does).

### Nothing to destroy downstream (rules out B; Task 9 not triggered)

The interpretation rule requires a factor clearing the bar **in both EW and VW on
residualized returns** to proceed to the destruction hunt. None did. There is no
detectable cross-sectional signal *at the source*, so "signal exists but is destroyed
by exits/construction/costs" (B) is not supported. Per the pre-registered gate,
**Task 9 (MFE/MAE, breadth) was not run** — there is no signal whose destruction to
localize. (`ledger_b9_full.csv` was still produced for Task 11; the conditional
`mfe21Pct/mae21Pct` simulator fields were not added, keeping the baseline
byte-identical.)

---

## Honest caveats — where A is not airtight

1. **Fundamental (value) factor — the one thing not cleanly zero.** Its residual
   deciles are the only ones that *survive value-weighting* at long horizons
   (`fundamental · resid`: h21 +1.00% EW / +0.63% VW; h63 +3.06% EW / +1.55% VW),
   and its short-horizon resid IC is the second-most significant (h1 NW-t 2.56). This
   is directionally sensible (a value premium) but **statistically unconfirmed** —
   NW-t ≈ 1.3–1.5 where the spread is largest, because 63-day overlapping windows
   give few independent observations. It does not clear the bar and is **not** a
   licensed "signal exists," but it is the single cell warranting a targeted
   follow-up (longer history, or a monthly-rebalanced non-overlapping value sort).

2. **The trade-ledger estimand is underpowered and says nothing either way.**
   Independent recomputation confirms B9 expectancy −0.04% / PF 0.97 exactly, but the
   stationary block-bootstrap 95% CI on expectancy is **[−0.40, +0.35]** — spans zero
   widely. From the 912-trade ledger *alone*, neither edge nor no-edge is licensed
   (the ST5 concern, confirmed). This is a *different, non-identifying* estimand from
   the cross-sectional IC; the verdict rests on the IC, not the ledger.

3. **Irreducible non-stationarity.** Over 5.5 years spanning one market cycle,
   "these features carry no information" cannot be fully separated from "these
   features carried information that decayed before/within the sample." A is the
   correct read of the *available* data, not a claim about all future regimes.

4. **Scope caveats carried from Phase 0 / the audit:** survivorship (today's
   constituents); the DQ filter is recorded as a column, not applied, so the panel is
   not itself DQ-survivorship-filtered; `xs`/`resid` subtract a **price** (PRI) Nifty;
   the VW/size proxy is `log(close×volume)`, not true market cap.

---

## One-line statement

> Measured for the first time with an identifying, gate-validated estimator, the
> eight factors and their composite show **no cross-sectional predictive information
> that clears a pre-registered significance bar** in any variant — while the same
> harness cleanly recovers 12-1 momentum and short-term reversal. The lone
> unconfirmed exception is a weak, value-weighting-robust residual tilt in the
> fundamental value factor, which merits one targeted follow-up but is not, on this
> sample, a licensed positive. **Verdict A**, with that flagged residual uncertainty.

---

### Deliverables produced
`architecture_review.md` · `research_layer_design.md` · `phase0_findings.md` ·
`harness_validation.md` (Gate A) · `positive_control.csv` + `positive_control_deciles.csv` (Gate B) ·
`rank_ic.csv` · `quantile_spread.csv` · `measurement_summary.md` · `price_audit.txt` ·
`ledger_b9_full.csv` · `verify.py` + `independent_verification.md` · `VERDICT.md`.
Conditional (not triggered — no signal): Task 9 MFE/MAE fields, `breadth_comparison.csv`.
