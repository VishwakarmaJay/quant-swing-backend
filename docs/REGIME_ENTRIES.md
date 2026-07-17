# Step 4 (redirected) — Regime-conditioned entry experiment

> **Run it:** `bun run backtest:regime` (read-only; needs the ~2yr backfill).
> **Mechanism:** `regimeGateOverrides` on `StrategyConfig` (default absent → baseline unchanged).
> **Why redirected:** the Fundamental factor is blocked on point-in-time historical data that
> doesn't exist in the system and can't be soundly sourced here (using today's PE/EPS to score a
> 2-year-old signal is lookahead). Step-1 already surfaced a bigger *measurable* lever with data we
> have: BULL regime is the loss sink. See `HANDOFF_NEXT_STEPS.md` §4.

## Question
Step-1 attribution found the losses are regime-linked: **BULL −0.67%/trade (PF 0.61, 397 trades)**;
SIDEWAYS ~breakeven. Can we *fix BULL entries* by tightening them (avoid overbought / require sector
leadership), or is the buy-trend-strength style simply unsuited to strong markets?

## Result

| variant | signals | overall exp | PF | Δexp | BULL n | BULL exp | BULL PF | SIDE n | SIDE exp |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 981 | −0.22 | 0.86 | — | 397 | −0.67 | 0.61 | 534 | +0.02 |
| **BULL: skip** (diagnostic) | 617 | **+0.06** | 1.04 | +0.29 | 0 | — | — | 567 | +0.01 |
| BULL: rsiMax 60 | 765 | −0.12 | 0.92 | +0.11 | 176 | **−0.76** | 0.55 | 539 | +0.01 |
| BULL: rsiMax 55 | 708 | −0.05 | 0.96 | +0.17 | 102 | **−0.73** | 0.56 | 556 | +0.00 |
| BULL: sectorRS ≥ 55 | 836 | −0.19 | 0.88 | +0.03 | 234 | **−0.92** | 0.50 | 552 | +0.04 |
| BULL: sectorRS ≥ 60 | 818 | −0.17 | 0.89 | +0.05 | 215 | **−0.88** | 0.52 | 553 | +0.03 |
| BULL: rsiMax60 + sRS≥55 | 692 | −0.02 | 0.99 | +0.20 | 85 | **−0.70** | 0.60 | 557 | +0.02 |

## The honest reading — no filter *fixes* BULL; only avoidance helps

1. **BULL is the entire source of the negative edge.** Skipping BULL takes the strategy from −0.22
   (PF 0.86, losing) to **+0.06 (PF 1.04, ~breakeven)**. SIDEWAYS on its own is a breakeven engine.
2. **None of the tightening rules select better BULL trades — they select *worse* ones.** Look at the
   BULL-only expectancy: every filter makes the *surviving* BULL trades **worse** than the −0.67
   baseline (rsiMax→−0.73/−0.76; sectorRS→−0.88/−0.92). The overall improvement comes **entirely from
   cutting BULL trade count** (397 → 85), i.e. avoidance, **not** from picking BULL winners.
3. **So the technical signal set contains no information that separates good BULL entries from bad
   ones** — consistent with Step-1 (nothing discriminates). Sector-leadership, which *helped* as a
   universe-wide selector (Step-3), does **not** rescue BULL specifically; the surviving leaders still
   lose there.

## Conclusion
- The buy-trend-strength entry style is **structurally unsuited to BULL markets** — it buys extension
  that reverts, and no threshold/leadership filter recovers edge. This is a *style* problem, exactly
  as Step-1 predicted.
- The only lever from existing data is **avoidance**: suppressing BULL entries removes the bleed and
  gets the strategy to ~breakeven. But breakeven is **not edge** — it still loses to Nifty (+10%), so
  Phase 5 stays gated. Avoidance stops losing; it doesn't start winning.
- **What BULL actually needs is a different entry style** (mean-reversion / pullback: buy strength on a
  *dip* within an uptrend, not at fresh highs). That's a real future build with data we have — and a
  better use of effort than the blocked Fundamental factor.

## Decision pending (operator)
Whether to wire a live BULL entry policy now (suppress or size-down BULL signals — reaches breakeven
but is blunt and forecloses a future BULL pullback strategy) or keep it observational and build a
proper BULL mean-reversion entry next. The `regimeGateOverrides` mechanism + `backtest:regime` harness
are in place either way.

## Caveats
Technicals-only; survivorship bias; signal-edge (no 2-position cap). "Skip BULL" reaches ~breakeven
partly on HIGH_VOL's tiny (n=12) positive sample — the durable claim is "BULL is a net drag that
filters can't fix," not a precise breakeven figure.

---

# Step 4b — BULL pullback entry (the actual fix) — ✅ hypothesis validated

> **Run it:** `bun run backtest:pullback`. **Code:** `src/strategy/bullPullbackStrategy.ts`
> (experimental; delegates to WeightedStrategy off-BULL, applies a pullback rule in BULL).

The Step-4 experiment showed filters only *avoid* BULL. So we tested a **different entry style** in
BULL: buy the uptrend on a **pullback** — price dipped back to ~EMA20, RSI cooled into a low band,
EMA20 > EMA50 > EMA200 stack intact — instead of at extended highs.

| BULL entry | signals | overall exp | PF | BULL n | **BULL exp** | BULL PF |
|---|---|---|---|---|---|---|
| baseline (buy strength) | 981 | −0.22 | 0.86 | 397 | **−0.67** | 0.61 |
| **rsi35-50, ext≤2%, stack** | 1005 | **−0.04** | 0.97 | 391 | **−0.21** | 0.77 |
| rsi40-55, ext≤2%, stack | 1269 | −0.16 | 0.88 | 671 | −0.33 | 0.72 |
| rsi40-55, ext≤0%, stack | 1116 | −0.09 | 0.93 | 502 | −0.28 | 0.74 |
| rsi40-60, ext≤3%, stack | 1325 | −0.22 | 0.84 | 736 | −0.42 | 0.66 |
| rsi40-55, ext≤2%, no-stack | 1961 | −0.19 | 0.86 | 1368 | −0.28 | 0.77 |

## Reading — this is a genuine fix, not avoidance
- **BULL expectancy improves in every variant** (−0.67 → −0.21…−0.42), and BULL PF rises 0.61 → up to
  0.77. Unlike the Step-4 filters (which made *surviving* BULL trades **worse**), the pullback entry
  makes them **better**.
- **The best variant (RSI 35–50, dip ≤2% above EMA20, stack) does it at the SAME trade count** (391
  vs 397) — so the −0.67 → −0.21 gain is a true apples-to-apples entry improvement, not a count
  artifact. Overall strategy moves to near-breakeven (−0.04, PF 0.97); SIDEWAYS unchanged (+0.01).
- **Coherent response:** tighter/lower RSI band + modest dip + stack requirement = best; loosening
  toward "buy strength" (RSI 40–60, ext≤3%) degrades back toward baseline. That monotonic pattern is
  the signature of real signal, not noise.

## Honest limits
- **BULL is still net-negative** (−0.21, PF 0.77 < 1). The pullback roughly *thirds* the per-trade
  loss and lifts PF, but doesn't make BULL profitable — so the strategy is near-breakeven, still no
  net edge, still loses to Nifty. **Phase 5 stays gated.**
- **v1 is a static dip snapshot** — no *resumption* confirmation (RSI/MACD turning back up off the
  dip). Buying a dip with no confirmation catches some that keep falling. The clear next lever is a
  v2 resumption filter, which is where BULL might cross into positive.
- Experimental only — **not wired into production**; it's a measurement vehicle until it (or a v2)
  clears a bar worth trusting.

## Step 4b-v2 — resumption confirmation + out-of-sample reality check
v1 buys a *static* dip (no confirmation the dip is ending). v2 adds a resumption gate — the MACD
histogram (and/or RSI) must be **rising** vs the prior bar — exposed as new momentum metrics
(`rsiPrev`, `histogramPrev`). Full-window result looked like a breakthrough:

| BULL entry (full window) | overall exp | PF | BULL n | BULL exp | BULL PF |
|---|---|---|---|---|---|
| baseline | −0.22 | 0.86 | 397 | −0.67 | 0.61 |
| v1 static dip (rsi35-50) | −0.04 | 0.97 | 391 | −0.21 | 0.77 |
| v2 rsi40-55 + histogram rising | **+0.06** | **1.05** | 289 | **+0.10** | **1.09** |

**But the config was picked from a grid, so it was validated on an in-sample/out-of-sample split
(train = first half of the tradeable window, test = second, unseen):**

| config | train overall | train BULL | **TEST overall** | **TEST BULL** |
|---|---|---|---|---|
| baseline (strength) | −0.16 (PF 0.89) | −0.43 | −0.28 (PF 0.82) | −1.47 |
| v2 rsi40-55 + hist rising | +0.27 (PF 1.23) | +0.26 | **−0.10 (PF 0.93)** | **−0.32** |

### The honest reading (the OOS check changed the conclusion)
- **The full-window "PF 1.05 / positive edge" was in-sample optimism.** On the unseen test half the
  same config is **net-negative (PF 0.93)** — the absolute positive edge does **not** generalize.
- **What DOES generalize is the *relative* improvement over buy-strength.** v2 beats baseline on
  *both* halves (overall +0.43 train, +0.18 test), and it turns the BULL catastrophe from −1.47 to
  **−0.32 on unseen data** (+1.15). Pullback+resumption is a genuinely better BULL *entry style* — the
  direction is robust — but it is **not, by itself, a positive edge.**
- The second (test) half was a harder, more BULL-heavy period (baseline −0.28 vs −0.16), which partly
  explains why even the improved entry stays negative there.

### Conclusion (Step 4b overall)
The Step-1 thesis is confirmed *constructively*: BULL needed a different entry *style*, not a filter,
and pullback+resumption robustly improves it across both halves. **But it does not clear a positive
out-of-sample edge — Phase 5 stays firmly gated**, and the earlier full-window numbers must not be
trusted as the real edge (the OOS numbers are the honest ones). This is a validated *component*, not
a finished strategy. Two robust *relative* levers now exist — sector-relative RS (Step 3) and this
BULL entry — each an improvement, neither an edge alone. Combining + weighting + **walk-forward**
validating them is Phase-6 work. The OOS lesson also stands as method: grid-picked configs must be
validated out-of-sample before they are believed.
