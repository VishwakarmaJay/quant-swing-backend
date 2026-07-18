# B5 — FundamentalFactor (built, measured, floor-mechanism favoured; no weight set)

> **Status:** built + integrated **observationally** (baseline byte-identical). The
> composite **bucket path is rejected on evidence**; the **floor gate** is the measured
> lever, OOS-favoured but **not graduated to production** (operator decision, B2 precedent).
> **Run the measurements:** `bun run backtest:attribution` (§2d/2e) · `bun run backtest:phase6` ·
> `bun run backtest:portfolio`. Tracker: [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md) B5.

## What was built

- **`FundamentalFactor`** (`src/factors/fundamentalFactor.ts`, name `fundamental`,
  category FUNDAMENTAL) — pure; scores two components, weights renormalized over
  whichever are computable (config `DEFAULT_FUNDAMENTAL_CONFIG`):
  - **VALUE (w 0.6):** tie-safe percentile of the stock's as-of P/E within its sector
    (cheaper than peers → higher). **Rank-based per the B4 adjustment audit** — robust to
    the single-name P/E distortions (demergers, exceptional items); loss-makers (P/E null)
    are excluded from the ranking, not winsorized into it. Needs ≥3 valid-PE peers.
  - **GROWTH (w 0.4):** TTM EPS YoY growth mapped linearly to 0–100, saturating at
    ±40% (`growthCapPct`); loss→profit turnaround scores 100; loss-both-years drops the
    component. Needs 8 known quarters.
  - **Results-proximity** (`resultsPending`, `daysSinceLastResult`) is exposed as
    metrics/explanation only — a risk flag, deliberately not scored.
  - No data at all → neutral 50, agreement 0 (index rows, unbackfilled DB).
- **Point-in-time reconstruction** (`fundamentalsAsOf` in `src/fundamentals/asOf.ts`, pure,
  fast ISO-string compares): TTM = the 4 most recent quarters **known by the date**
  (`availableAt = announcedAt ?? SEBI fallback`); a quarter announced on day D enters
  only after D (conservative, matches `ttmEpsKnownBy`'s verified boundary semantics).
  YoY base = known quarters 5–8.
- **Injection pre-pass** (evaluate stays pure, the `sectorPeers` pattern):
  - Backtest: `CandleStore.fundamentalsBySymbol` (one load) + a per-day cross-sectional
    pass in `generateRawSignals` → `ctx.fundamentals` (own snapshot + sector valid-PE list).
  - Live: `loadFundamentalInputs()` (`src/factors/context.ts`) wired into `runPipeline`,
    `factors:eval`, `strategy:eval`, `signal:inspect`.
- **Observational guarantee:** `DEFAULT_STRATEGY_CONFIG.buckets.fundamental` is now `[]`
  (numerically identical — the bucket had no live member before B5; a listed factor would
  auto-activate the regime-weight blend). Regression tests pin byte-identity and the
  explicit activation lever. Golden consciously re-baselined (every bundle now carries the
  neutral `fundamental` entry); `factorConfigChecksum` now stamps the fundamental config.
  **Real-data proof:** post-integration `backtest:run` reproduces the documented baseline
  exactly (981 trades, 41.3% win, −0.224%/trade, PF 0.86, exit mix 539/242/172/21).
- Optional **`fundamentalFloor`** strategy config + `fundamental-floor` gate (reads the
  factor result straight off the bundle, independent of bucket activation — like the
  sector-leadership gate). Absent in default/production config.

## What was measured (the selection tests + walk-forward)

**Conditioning** (baseline 981-trade set): Spearman ≈ 0 (+0.008) like every factor — but
the terciles show the pattern that matters: **the low-fundamental tercile is the loss sink
(−0.38%/trade) vs mid/high (−0.14/−0.15)**. The information is in the *tail*, not the rank.

**§2d — bucket activation at λ × the spec regime weights (selection test): REJECTED.**
Monotonically harmful with dose — the blend re-ranks everything by a score with no
rank information and drops signals without picking better ones:

| fund λ | signals | exp% | PF | Δexp |
|---|---|---|---|---|
| 0.10 | 941 | −0.25 | 0.84 | −0.02 |
| 0.25 | 888 | −0.24 | 0.85 | −0.01 |
| 0.50 | 798 | −0.25 | 0.84 | −0.03 |
| 1.00 | 676 | −0.35 | 0.79 | −0.12 |

**§2e — floor gate (reject fundamental < floor): the working mechanism.** Concave
dose–response peaking at 50 — the ATTRIBUTION.md standard for a real signal:

| floor | signals | exp% | PF | Δexp |
|---|---|---|---|---|
| 40 | 772 | −0.19 | 0.87 | +0.03 |
| 45 | 698 | −0.18 | 0.88 | +0.05 |
| **50** | **605** | **−0.15** | **0.90** | **+0.07** |
| 55 | 515 | −0.19 | 0.88 | +0.04 |

**Walk-forward** (grid = incumbent levers × floor {none, 45, 50}): floor variants selected
on **2 of 3 folds** (ff45 then ff50; fold-1 train pre-dates most of the fundamentals
history). Concatenated OOS: **−0.09%/trade, PF 0.93** vs the incumbent's −0.12/0.91 and
baseline's −0.34/0.78. Most recent fold: +0.29/PF 1.19 (one fold ≠ edge). Caveat: the
per-fold pick now churns (3 configs across 3 folds) where `pullback+srs0.25` used to win
all three — some of the OOS gain is selection noise, treat +0.03 as the honest size.

**Portfolio level** (`combined+ff50` added to `backtest:portfolio`): OOS it ties combined
on flat/conviction and **wins on risk sizing (−10.45% vs −13.66%) with the smallest
drawdown in the table (−12.2%)**, higher win rate (41.7% vs 36.8%), and stays ahead at 2×
costs. But on the FULL window it *underperforms* combined (−12.25% vs −3.33% flat) — the
early window has thin fundamentals coverage (few known quarters), and with a 2-slot book
n≈140 sequencing effects are large. Everything still trails Nifty B&H in both windows.

## The honest verdict

1. **The factor is real but its information lives in the tail.** Ranking by it (bucket
   blend) hurts; refusing its worst tail (floor ≥50) helps modestly and coherently across
   selection test, walk-forward, and OOS portfolio (where it also cuts drawdown).
2. **No weight is set.** The bucket stays empty on evidence. The floor is a validated
   *research lever* — adopting `ff50` into production is an operator decision (B2
   precedent); on current evidence it is OOS-favoured but full-window-negative at
   portfolio level, so the default recommendation is **hold observational** and let B9
   (joint rerun, ideally after more fundamentals history accrues) decide.
3. **Phase 5 stays hard-gated.** OOS PF 0.93 < 1; portfolio still trails Nifty everywhere.
4. **Data caveats:** fundamentals coverage *grows through the window* (TTM needs 4 known
   quarters, growth 8 — early 2025 dates see far less than 2026 dates); Screener-sourced
   EPS is as-reported today (restatements invisible); survivorship applies (today's
   universe, today's Screener pages); 8% of quarters are SEBI-deadline-dated, not
   announcement-dated.

## Files

`src/factors/fundamentalFactor.ts` (+ tests) · `src/fundamentals/asOf.ts`
(`fundamentalsAsOf`, + tests) · `src/fundamentals/store.ts` · `src/factors/context.ts`
(`loadFundamentalInputs`) · `src/backtest/{candleStore,backtestEngine}.ts` (pre-pass) ·
`src/strategy/{types,weightedStrategy}.ts` (`fundamentalFloor` gate, empty bucket) ·
`src/scripts/{runAttribution,runPhase6,runPortfolioBacktest}.ts` (§2d/§2e + grids) ·
golden re-baselined · **221/221 tests, typecheck clean.**
