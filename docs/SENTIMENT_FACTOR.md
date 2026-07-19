# SentimentFactor (B7) — build + evaluation plan

> **Status (2026-07-19):** 🟢 **Phase 1 built — code complete, OBSERVATIONAL.** The factor
> computes into every FeatureBundle but the frozen baseline keeps `buckets.sentiment: []`,
> so live signals and the golden/backtest baselines are **byte-identical**. Phase 2
> (attribution + walk-forward measurement) runs once overnight FinBERT scoring completes.
> Nothing here changes trading behaviour until the bucket is activated on walk-forward
> evidence (B9).

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
