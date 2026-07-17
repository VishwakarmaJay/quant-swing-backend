# HANDOFF — QuantSwing next steps (read this first)

> **Purpose of this file:** onboarding + the agreed action plan, in one place, so a new
> Claude Code session (possibly on a different account) can understand the whole project
> and know exactly what to do next from a single prompt.

---

## 0. One-prompt kickoff for the next Claude

Paste this as your first message in the new session:

> Read `docs/HANDOFF_NEXT_STEPS.md`, then `docs/START_HERE.md` and `docs/SYSTEM.md`.
> This is QuantSwing, a deterministic quant decision-support system for NSE equities.
> The backtest proves the current strategy has **no edge** and the problem is the
> **entries, not the exits**. Do NOT jump to building new factors. Follow the numbered
> sequence in the handoff file, starting at **Step 1 (factor attribution)** and
> **Step 2 (doc reconciliation)**. Confirm you understand the plan, then ask me which
> step to start.

That's enough for the new session to orient itself and continue.

---

## 1. What this project is (30-second version)

- **Deterministic, explainable decision-support system** for Indian equities (NSE) — *not*
  a trading bot. Scans ~166 stocks nightly, emits ranked/gated/risk-sized **buy signals to
  Telegram; orders are placed manually.**
- **Design creed:** every number is reproducible from stored candles + versioned config. No
  randomness, no wall-clock reads inside factor logic, every rejection has a recorded reason.
- **Stack:** Bun + TypeScript + Express + Prisma/PostgreSQL + Redis (+ RabbitMQ). All
  indicator math is in-house so it can be golden-tested.
- **Pipeline:** `OHLCV → DataQuality → 5 factors → regime → WeightedStrategy (composite + 7
  gates) → signal math (ATR stop, T1/T2, R:R) → PortfolioManager (sizing, caps, kill switch)
  → versioned persistence → Telegram`.
- **Status:** Phases 1–4 complete (data, factors, golden gate, decision layer, backtesting).
  112 tests pass, typecheck clean.

## 2. The one finding that drives everything

Backtest over **~16 months / 981 trades**:

- Win rate **41.3%**, expectancy **−0.22%/trade**, profit factor **0.86** (<1 = loses money).
- Nifty Buy & Hold over the same window: **+10%**. The strategy badly underperforms.
- Exit mix: 539 time-stops · 242 stops · only **21** target2 hits → trades enter then go nowhere.
- **The parameter sweep is decisive: all 16 exit configs lose.** → **The problem is the
  ENTRIES, not the exits.** No exit tuning rescues entries that lack edge.

**Root context:** Sentiment + Fundamental factors are **not built**, so their weight-buckets
renormalize out and `composite = technicalScore`. The live strategy is effectively **four
correlated trend/momentum factors** (Trend, Momentum, RS-vs-Nifty, Volume) behind
trend-aligned gates — a low-diversity "buy strength" signal that buys extended uptrends which
then chop sideways.

## 3. Documentation drift — the spec docs lie about the as-built system

`quantswing-docs/` is the **original frozen spec**; `SYSTEM.md`/`START_HERE.md` are the
**honest as-built** state. These spec docs are now **stale and misleading**:

| Topic | Spec docs say | As-built (code / SYSTEM.md) |
|---|---|---|
| Factors built | `FACTOR_CATALOG.md` marks Sentiment, Fundamental, SectorRotation **"active"** | Only 4 technical factors + Volatility; **Sentiment/Fundamental not built** |
| Sizing model | Fixed **₹50 risk/trade**, qty from stop distance, cap ₹3,000 | **Conviction-based**: capital = ₹100k × (composite/100), no cap |
| Capital / kill switch | ₹5,000 capital, ₹50 kill switch | ₹100,000 base, ₹5,000 kill switch |
| SL band | 0.5%–**3.0%** | 0.5%–**10%** (operator override) |
| R:R gate (#6) | **R:R ≥ 2.0** | Realized as **minResistanceRr 1.5** |
| Job queue | BullMQ (Redis) | **RabbitMQ** |
| Intraday checks | 3×/day thesis checks + 08:45 pre-market | Not implemented (cron: 08:00 sync, 16:30 OHLCV, 17:00 signal run) |
| Regime inputs | + 52w hi/lo breadth, VIX<15 BULL, per-regime size multipliers, defensive-only BEAR | Simpler: EMA50 breadth only, no size multipliers |

None are bugs — they're drift. But `FACTOR_CATALOG.md`, `TRADING_RULES.md`, and
`STRATEGIES.md` (gate #6) describe a system that isn't the one in `src/`.

---

## 4. THE PLAN — what to do first (agreed sequence)

Ordered by "cheapest thing that most changes what you do next" — **not** by what's most
exciting to build. **Measure before you build.**

### Step 1 — Attribution on the 4 existing factors (before building anything) ✅ DONE
**Why first:** The backtest says entries lack edge, but no one has measured *which* factor is
responsible. `RESEARCH_PROTOCOL.md` demands out-of-sample attribution before promotion — yet
all 4 current factors were "grandfathered as H-0," never tested. Use the Phase-4 harness
(`generateRawSignals` once, then re-simulate) to answer: does any single factor, or any gate,
have positive marginal edge? A few days of analysis with tools that already exist; it decides
everything downstream. You may find a factor is actively *hurting* → pruning beats adding.

**Decision gate:** if nothing in the current set shows edge, the *entry style itself* (buying
trend strength) is the problem — which reframes Steps 3–4.

**✅ RESULT — the decision gate tripped. Full findings: [`ATTRIBUTION.md`](./ATTRIBUTION.md).**
Built `bun run backtest:attribution` (conditioning + gate/factor leave-one-out). Over the same
981 trades:
- **Nothing discriminates winners from losers** — Spearman(score, return) ≈ 0 for every factor
  *and for the composite* (ρ = −0.02). The conviction score that drives sizing is uninformative.
- **The scoring gates are largely inert** — the composite-threshold and technical-floor gates earn
  nothing (disabling them doesn't change expectancy); only the **RSI 35–68 band** does real
  filtering. Gates trim the losing tail but can't create edge.
- **Losses are structural and regime-linked** — BULL regime is the sink (397 trades, expectancy
  −0.67%, PF 0.61); SIDEWAYS is ~breakeven. The strategy buys the most extended trend-strength
  names right as they revert.
- **Factor ranking:** trend contributes most, relativeStrength mild, momentum ≈ 0, **volume is
  mildly harmful** (dropping it *helps*).

**⇒ It's the entry *style*, not any one factor.** This **reprioritises the plan**: piling on more
lagging trend-aligned factors won't fix a style problem. Favour **orthogonal** signal (Fundamental,
sector-relative RS) over another momentum-family factor; consider **regime-conditioned entries**
(don't buy the most extended names in BULL); **prune/fix volume**; and defer weight-learning
(Phase 6) until an orthogonal signal exists — reweighting a ρ≈0 composite won't help.

### Step 2 — Reconcile the stale docs (parallel, low-effort) ✅ DONE
**Why now:** `FACTOR_CATALOG.md` claims factors that don't exist; `TRADING_RULES.md` and
`STRATEGIES.md` describe old sizing (₹50 risk) and the R:R≥2.0 gate the code no longer uses.
Anyone reading them reasons about a system that isn't real. ~1 hour of edits; prevents wrong
decisions in Steps 3–6. Use the table in §3 as the checklist.

**✅ RESULT — every §3 drift row reconciled.** Approach: kept the original spec as the frozen
record but added a **⚠️ STALE/AS-BUILT banner** + inline `[AS-BUILT]` corrections to each affected
doc, all pointing to `SYSTEM.md` as authoritative.
- **Core (§3-named):** `FACTOR_CATALOG`, `TRADING_RULES`, `STRATEGIES`, `MARKET_REGIMES`,
  `TECH_STACK`, `SYSTEM_PIPELINE`, `PROJECT_DESCRIPTION`, `MODULES`, `README`, `ASSUMPTIONS`,
  `KNOWN_LIMITATIONS`.
- **BullMQ→RabbitMQ + indicatorts→in-house drift** (pervaded the decision/ops docs): amended
  **ADR 0008** (supersession note — the ADR that argued "BullMQ not RabbitMQ" is reversed as-built),
  its indexes (`ADR/README`, `DECISIONS`), `CHANGELOG`, and the operational docs (`DEPLOYMENT`,
  `OBSERVABILITY`, `PERFORMANCE_GUIDE`, `NON_FUNCTIONAL_REQUIREMENTS`, `CLAUDE_CONTEXT`,
  `IMPLEMENTATION_RULES`, `TROUBLESHOOTING`).
- **`ROADMAP`** got a status banner (Phases 1–4 done; Phase 5 is NOT next).
- **Intentionally left as historical point-in-time artifacts:** the `planning/SPRINT_*`,
  `IMPLEMENTATION_ORDER`, `BACKLOG` checklists (they record what was planned per sprint, like ADRs
  of intent — not claims about current state).

### Step 3 — Sector-relative RS (first real build) ✅ DONE
**Why before Sentiment/Fundamental:** Smallest, self-contained improvement — the *deferred
half* of a factor you already have (`RelativeStrengthFactor` is vs-Nifty only). Adds genuine
cross-sectional info (which stocks lead their sector), needs only price data already stored,
and is backtestable immediately. High information-per-unit-effort.

**✅ RESULT — built, measured, shows promise; weight deferred. Findings: [`ATTRIBUTION.md`](./ATTRIBUTION.md) addendum.**
- New `SectorRelativeStrengthFactor` (`src/factors/sectorRelativeStrengthFactor.ts`): tie-safe
  percentile rank of the stock's 60d return within its sector. Cross-sectional peer data is injected
  via a **pre-pass** (`ctx.sectorPeers`) so `evaluate` stays pure — wired into the backtest loop,
  the live pipeline (`loadSectorPeerReturns`), and the eval scripts; golden consciously re-baselined;
  **129/129 tests pass** (+8 new). Built as a **separate factor** (not blended into RS) so it stays
  independently attributable.
- **Integrated observationally (weight 0):** computed into every FeatureBundle but not in the
  composite, so the 981-signal baseline is byte-identical — it perturbs nothing until we choose to.
- **Selection test (attribution `2c`):** adding it at weight ≈0.25 improves backtested expectancy
  **−0.22 → −0.13** and PF **0.86 → 0.92** by dropping ~125 sector-laggard trades. Concave in weight
  (peaks ~0.25) → real signal. **First orthogonal factor that measurably helps.** Still net-negative
  (not a fix). Note: plain *conditioning* showed ρ≈0 — only the *selection* test revealed the value.
- **Decision (operator): weight deferred to Phase 6** (joint learned weighting) rather than hand-set
  now — keep it observational until Fundamental exists and weights can be fit together.

### Step 4 — Sentiment (FinBERT) + Fundamental factors
**Why here, not first:** The docs' thesis for the missing edge, but the *biggest* build
(Python sidecar, news archive, Screener/NSE ingestion) — and Sentiment **can't be backtested**
until ~6 months of news archive accumulates (per `BACKTESTING.md`/`ASSUMPTIONS.md`). So:
**start the news-archive collection now** (a clock you can't rewind), but don't gate progress
on it. Build **Fundamental first** since it *is* backtestable against history.

### Step 5 — Phase 6: evaluation + ML weighting
Only once attribution shows the factor set contains edge. Re-run sweep/attribution across the
enriched set, prune what doesn't contribute, then let weighting be **learned** rather than
hand-set.

### Step 6 — Phase 5: paper trading (last, still gated)
Its entry criterion is "beat Nifty risk-adjusted," which the backtest currently **fails**. Do
not start until a backtest actually clears that bar. Paper-trading a known-negative strategy
just burns calendar time.

---

## 5. One-line version + the key risk

**Measure before you build** — run attribution (1) and fix the docs (2) this week; then the
cheap RS extension (3); start the news clock but build Fundamental first (4); then let Phase 6
(5) tell you what actually has edge before anyone paper-trades (6).

**Biggest risk in the original START_HERE plan:** skipping straight to Step 4 on faith. If the
entry *style* is the problem, adding two more lagging factors won't fix it — and **only Step 1
tells you that, at near-zero cost.**

---

## 6. Where to look in the repo

| To understand… | Read |
|---|---|
| Whole system + all math | `docs/SYSTEM.md` (authoritative as-built) |
| Onboarding | `docs/START_HERE.md` |
| Original spec / ADRs (⚠️ partly stale — see §3) | `docs/quantswing-docs/` |
| Factors (pure math) | `src/factors/` |
| Regime / strategy / signal math / portfolio | `src/regime/`, `src/strategy/`, `src/signal/`, `src/portfolio/` |
| Backtesting + the finding | `src/backtest/` |
| DB schema | `prisma/schema.prisma` |

Run commands: `bun run backtest:run` (replay vs Nifty), `bun run backtest:sweep` (parameter
sensitivity), `bun test`, `bun run typecheck`. Determinism is sacred — any factor change that
shifts a number fails the golden test; re-baseline with `bun run golden:update` and justify it.
