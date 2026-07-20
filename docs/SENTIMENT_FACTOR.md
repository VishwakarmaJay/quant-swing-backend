# SentimentFactor (B7) — build + measurement

> **Status (2026-07-20):** ✅ **Phase 2 MEASURED — floor mechanism favoured, held
> observational.** The bucket blend is **rejected on evidence** (2f, mirrors B5); the
> **`sentimentFactorFloor: 50` gate is the working mechanism** — the strongest single-lever
> selection delta measured in the project (+0.11 exp on the strong-evidence tier, first
> full-window breakeven crossing) — but walk-forward-validated on only **one
> coverage-capable fold** (+0.14 / PF 1.12 unseen). Treatment: the `ff50` precedent —
> observational. Results: §4a. **[B9, same day]** the anchored walk-forward then selected
> sf50 inside the joint best strategy on all 4 coverage-era folds × both tiers
> ([`B9_RERUN.md`](./B9_RERUN.md)); production adoption remains an open operator decision.
> Nothing here changes trading behaviour; the frozen baseline stays byte-identical.

---

## 1. What it does

Turns the FinBERT-scored news archive (B3/B3.5/B3.6/B6) into a per-stock **0–100 sentiment
score** (50 = neutral) as of an evaluation date, and exposes it as a `SENTIMENT`-category
factor on the existing contract (score + agreementContribution + explanations + metrics).
Pure and deterministic like every other factor — the point-in-time article set is injected
via `ctx.sentiment`; the factor only aggregates.

## 2. Aggregation math (`src/news/sentimentAggregate.ts`)

For a stock, over articles with `availableAt ≤ asOf` within `windowDays` (default 30):

```
recency(i)    = 0.5 ^ (ageDays_i / halfLifeDays)     # chase-decay (default half-life 7d)
confidence(i) = max(0, 1 − neutralProb_i)            # decisive news > "meh" neutral
w(i)          = recency(i) × confidence(i)
mean          = Σ w(i)·score_i / Σ w(i)              # score_i = FinBERT pos−neg ∈ [−1,1]
sentiment     = 50 + 50·mean                         # 0–100
```

- **Thin coverage = no information, not bearish silence.** Below `minArticles` (default 3),
  or when every contributing article is fully neutral (Σw ≈ 0), the aggregate is `null` and
  the factor returns **neutral 50, agreement 0** — the same missing-data convention as the
  fundamental factor. This biases the factor toward well-covered large caps: a **documented
  limitation** (§5), not an accident.
- **Deterministic:** article order does not affect the result; scores clamp to [−1, 1].
- Config: `windowDays`, `halfLifeDays`, `minArticles` (`DEFAULT_SENTIMENT_AGGREGATE_CONFIG`).

## 3. Point-in-time contract (no lookahead)

The one discipline that makes the B7 backtest honest: an article contributes only if its
**`availableAt` ≤ the as-of cutoff** — never `publishedAt`/`fetchedAt`. The cutoff is
**midnight (UTC) of the as-of date**, so same-day-later news is excluded (conservative for a
daily swing signal; identical in the live loader and the backtest replay). `ageDays =
(asOf − availableAt)/day`. Backfilled rows carry a *reconstructed* `availableAt`
(publishedAt + latency) — weaker than live capture, which is why §4 evaluates per-origin.

Enforced in two mirrored places, both keyed on `availableAt`:
- **Live pre-pass** — `loadSentimentInputs(asOf)` (`src/factors/context.ts`): SQL window,
  injected via `buildStockContext` into `runPipeline`.
- **Backtest replay** — `loadNewsBySymbol()` preloads the scored archive into the
  `CandleStore`; `sentimentInputsAsOf(articles, asOfMidnight, window)` (pure, unit-tested
  for the lookahead guard) builds each day's inputs in `backtestEngine.ts`.

## 4. Evaluation plan (Phase 2 — after scoring completes)

1. **Attribution / selection** (`backtest:attribution`): does sentiment discriminate winners
   from losers? Conditioning + a selection test at candidate composite weights.
2. **Embargoed walk-forward** (`backtest:phase6`): config selected on train, measured on
   unseen test, across expanding folds — the honest gate.
3. **Per-origin, always.** Every split is run three ways — `LIVE_* only` (strongest
   evidence) vs `+ BSE_BACKFILL` vs `+ GDELT` — so any measured edge is proven on the tier
   whose `availableAt` is most trustworthy, not on reconstructed timestamps.
   `loadCandleStore({ sentimentOrigins })` / `loadNewsBySymbol(origins)` gate this.
4. **Activation** is the explicit config lever `buckets.sentiment: ['sentiment']` — set only
   on that evidence (B9), exactly how the SRS weight and the fundamental floor graduated.

## 4a. Phase 2 RESULTS (measured 2026-07-20, deep 5.5yr window, 4,394-trade baseline)

Run on the workstation (VM is credit-throttled), archive synced from the box
(172,867 rows, 100% FinBERT-scored). All three tiers reproduce the documented B8.1
deep-window baseline exactly (4,394 trades, −0.10%/trade, PF 0.94).

### Coverage per tier — and a clean null control
| tier | scored articles | trades with informed (≠ 50) score |
|---|---|---|
| `live` | 206 | **0.0%** — null control |
| `live+bse` | 58,266 | 48.0% |
| `all` (+GDELT) | 162,381 | 48.6% |

The `live` tier proved the mechanism inert without data: floors ≤ 50 changed **nothing**
(Δ exactly 0, 0 signals dropped). Any effect on the other tiers is therefore data, not
gate mechanics. GDELT's 104k rows add only ~0.6pp of trade coverage over BSE alone.

### Conditioning — the B5 tail pattern again
Spearman ≈ 0 (like every factor), but the `live+bse` terciles rise monotonically:
low **−0.33/PF 0.81** → mid −0.03/0.98 → high **+0.07/1.05**. The information lives in
the negative tail, not the ranking.

### 2f — bucket blend: REJECTED (the B5 verdict repeats)
λ = 0.1 → +0.01/+0.02 exp; decays monotonically to −0.05/−0.06 by λ = 0.5. No interior
peak. The null control also showed the test is contaminated by neutral-50 dilution
(activating the bucket re-ranks the composite even with zero informed scores), so even
the λ=0.1 blip is not trustworthy. `buckets.sentiment` stays `[]`.

### 2g — floor gate: the working mechanism
Reject `sentiment < floor`, keeping neutral/uncovered names (thin coverage ≠ bearish):

| floor | `live+bse` Δexp | → exp/PF | `all` Δexp |
|---|---|---|---|
| 40 | +0.02 | | +0.03 |
| 45 | +0.02 | | +0.02 |
| 48 | +0.04 | | +0.03 |
| **50** | **+0.11** | **+0.01 / PF 1.01** | +0.07 |
| 55 | −0.20 (−90% signals) | | −0.24 |

Concave, interior peak at 50 — the ATTRIBUTION.md signature of real signal, and the
**largest single-lever selection delta measured in the project** (fundamental's floor:
+0.07 on the 2yr window). `sf50` is the first configuration to cross full-window
breakeven. **Per-origin ordering passes the artifact test in the right direction:** the
effect is *stronger* on exchange-timestamped evidence (+0.11) than with GDELT's
reconstructed availability added (+0.07) — a lookahead artifact would show the opposite.

### Embargoed walk-forward (`backtest:phase6`, grid + sf48/sf50/ff50+sf50)
Folds now span the deep window — and that matters: folds 1–2 test windows largely
**predate the news archive** (backfills start 2024-01/2025-01), so the sentiment lever
was structurally invisible to them. Selection (identical on both tiers):

| test window | selected | test exp | PF |
|---|---|---|---|
| 2023-01→2024-03 | baseline | +0.46 | 1.36 |
| 2024-03→2025-05 | ff50 | −0.46 | 0.77 |
| 2025-05→2026-07 | **pullback+srs0.25+ff50+sf50** | **+0.14** | **1.12** |

Concatenated OOS: selected +0.15/PF 1.10 vs baseline control −0.04/0.97 — but per-fold
picks churn (3 configs / 3 folds), so read part of that spread as selection noise (the
B5 caveat). The honest sentiment statement: **selected on 1 of 1 coverage-capable folds,
+0.14/PF 1.12 on unseen data** — the pre-registered "≥2 of 3 folds" bar was unmeetable
by construction, not failed. Also noteworthy: on this deeper window the *incumbent*
story churns too (plain baseline won the 2023 bull-tape fold — the incumbents were
tuned on 2025-era data).

### Verdict
1. **Bucket blend rejected; floor mechanism favoured** — B5's shape, stronger dose.
2. **Evidence class: promising, not proven.** Selection-test strength + tier-robustness
   + one clean OOS fold ≠ the multi-fold validation SRS/pullback earned. Coverage only
   spans ~2.5yr of a 5.5yr window; the walk-forward can't say more until either coverage
   accrues or a coverage-era fold design is run (B9 task).
3. **Held OBSERVATIONAL** (the `ff50` precedent): `sentimentFactorFloor` exists as a
   validated research lever; absent from default/production config; `weightsVersion`
   untouched. **[B9 UPDATE, 2026-07-20]** The joint call was made: the anchored
   coverage-era walk-forward selected `pullback+srs0.25+ff50+sf50-novol` on **all 4
   folds × both tiers** — sf50 earned its place in the one best evaluated strategy
   ([`B9_RERUN.md`](./B9_RERUN.md)). Production adoption remains an open operator
   decision; the B10 gate is still failed.
4. Caveats: coverage grows through the window (floor inert early, active late — fold-1
   train is nearly sentiment-blind); headline-level FinBERT; survivorship; signal-edge
   units (portfolio-level truth still pending in B9 via `backtest:portfolio`).

## 5. Limitations

1. **Coverage-skewed toward large caps.** Precision-first symbol mapping + the thin-coverage
   neutral means small/thinly-covered names accumulate few tagged articles and stay neutral.
2. **Headline-level FinBERT.** Scores are per headline (bodies range absent→boilerplate);
   occasional misreads ("shares tank as SEBI probes" → weakly positive) are averaged over,
   not fixed per-article — the aggregation *is* the mitigation.
3. **Reconstructed availability on backfilled rows** (B3.5/B3.6). Real for live rows; a
   conservative assumption for GDELT/BSE history — hence the per-origin evaluation.
4. **v1 dedup relies on ingest-time dedup.** Cross-origin confirmation count is not yet a
   confidence input (the architecture review's cluster-not-drop upgrade is future work).

## 6. Where things live

| Piece | File |
|---|---|
| Aggregation core + point-in-time filter | `src/news/sentimentAggregate.ts` (+ `.test.ts`) |
| Factor | `src/factors/sentimentFactor.ts` (+ `.test.ts`) |
| Injected type | `src/factors/types.ts` (`StockSentiment`, `SentimentArticleInput`) |
| Live pre-pass | `src/factors/context.ts` (`loadSentimentInputs`) → `runPipeline.ts` |
| Backtest pre-pass | `src/backtest/candleStore.ts` (`loadNewsBySymbol`) → `backtestEngine.ts` |
| Observational config | `src/strategy/types.ts` (`buckets.sentiment: []`) |
| Byte-identity regression | `src/strategy/weightedStrategy.test.ts` |
