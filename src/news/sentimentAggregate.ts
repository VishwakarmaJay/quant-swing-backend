/**
 * Sentiment aggregation core (ROADMAP B7) — pure, deterministic, point-in-time.
 *
 * Turns the FinBERT-scored articles known for a stock as-of a date into a single
 * per-stock sentiment score in 0–100 (50 = neutral). The design goals from the
 * factor catalog: "FinBERT aggregate, recency-weighted, dedup, chase-decay".
 *
 * This function is PURE: it takes already-as-of-filtered, dated article inputs
 * (the point-in-time cut — `availableAt ≤ asOf` — is the pre-pass's job, exposed
 * here only as `ageDays ≥ 0`) and never reads a clock, the DB, or env. That keeps
 * the SentimentFactor deterministic (golden-testable) exactly like the technical
 * and fundamental factors.
 *
 * Weighting, per article i:
 *   recency(i)    = 0.5 ^ (ageDays_i / halfLifeDays)      — chase-decay: a
 *                   `halfLifeDays`-old article counts half as much as a fresh one.
 *   confidence(i) = max(0, 1 − neutralProb_i)             — a decisive
 *                   pos/neg article carries more signal than a "meh" neutral one.
 *   w(i)          = recency(i) × confidence(i)
 *   mean          = Σ w(i)·score_i / Σ w(i)               — score_i = pos−neg ∈ [−1,1]
 *   sentiment     = 50 + 50·mean                          — 0–100, 50 = neutral
 *
 * Thin coverage is treated as *no information*, not as bearish silence: below
 * `minArticles` (or when every article is fully neutral so Σw ≈ 0) the aggregate
 * reports `null` and the factor stays neutral 50 — the same convention the
 * fundamental factor uses for missing data. This deliberately biases the factor
 * toward large caps (well-covered) — a documented limitation, not an accident.
 */

/** One scored article's inputs to the aggregate (as-of already applied upstream). */
export type SentimentArticleInput = {
  /** asOf − availableAt, in days (≥ 0; fractional allowed). Point-in-time key. */
  readonly ageDays: number;
  /** FinBERT pos − neg ∈ [−1, 1]. */
  readonly score: number;
  /** FinBERT neutral probability ∈ [0, 1] — drives the confidence weight. */
  readonly neutralProb: number;
};

/** A stored scored article with its availability timestamp (ms since epoch). */
export type DatedScoredArticle = {
  readonly availableAtMs: number;
  readonly score: number;
  readonly neutralProb: number;
};

const DAY_MS = 86_400_000;

/**
 * Point-in-time filter shared by the backtest replay (and mirroring the live
 * SQL loader): from a stock's stored articles, keeps only those available
 * within `(asOfMs − windowDays, asOfMs]` — **strictly at or before the as-of
 * cutoff, never after** (the no-lookahead guarantee) — and stamps each with its
 * `ageDays`. `asOfMs` is the as-of cutoff (the platform uses midnight of the
 * as-of date, so same-day-later news is excluded — conservative for a daily
 * swing signal). Pure; input order preserved.
 */
export const sentimentInputsAsOf = (
  articles: readonly DatedScoredArticle[],
  asOfMs: number,
  windowDays: number = DEFAULT_SENTIMENT_AGGREGATE_CONFIG.windowDays,
): SentimentArticleInput[] => {
  const windowStartMs = asOfMs - windowDays * DAY_MS;
  const out: SentimentArticleInput[] = [];
  for (const a of articles) {
    if (a.availableAtMs > asOfMs || a.availableAtMs <= windowStartMs) continue;
    out.push({ ageDays: (asOfMs - a.availableAtMs) / DAY_MS, score: a.score, neutralProb: a.neutralProb });
  }
  return out;
};

export type SentimentAggregateConfig = {
  /** Only articles with `ageDays ≤ windowDays` contribute. */
  windowDays: number;
  /** Chase-decay half-life (days): weight halves every `halfLifeDays` of age. */
  halfLifeDays: number;
  /** Minimum contributing articles for a non-null aggregate (else neutral). */
  minArticles: number;
};

export const DEFAULT_SENTIMENT_AGGREGATE_CONFIG: SentimentAggregateConfig = {
  windowDays: 30,
  halfLifeDays: 7,
  minArticles: 3,
};

export type SentimentAggregate = {
  /** 0–100 (50 = neutral); null when there is not enough signal. */
  readonly score: number | null;
  /** Weighted mean article sentiment ∈ [−1, 1]; null when score is null. */
  readonly mean: number | null;
  /** Articles inside the window that contributed weight. */
  readonly count: number;
  /** Sum of weights (a coverage/confidence proxy); 0 when nothing contributed. */
  readonly weight: number;
  /** Age (days) of the freshest contributing article, or null. */
  readonly freshestAgeDays: number | null;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Rounds to `dp` decimals (deterministic; avoids FP noise in golden output). */
const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/**
 * Aggregates a stock's as-of articles into a point-in-time sentiment score.
 * Pure and deterministic; article order does not affect the result.
 */
export const aggregateSentiment = (
  articles: readonly SentimentArticleInput[],
  config: SentimentAggregateConfig = DEFAULT_SENTIMENT_AGGREGATE_CONFIG,
): SentimentAggregate => {
  const { windowDays, halfLifeDays, minArticles } = config;

  let wSum = 0;
  let wScoreSum = 0;
  let count = 0;
  let freshestAgeDays: number | null = null;

  for (const a of articles) {
    if (!(a.ageDays >= 0) || a.ageDays > windowDays) continue; // NaN-safe, in-window
    const recency = 0.5 ** (a.ageDays / halfLifeDays);
    const confidence = clamp(1 - a.neutralProb, 0, 1);
    const w = recency * confidence;
    count++;
    if (freshestAgeDays === null || a.ageDays < freshestAgeDays) freshestAgeDays = a.ageDays;
    if (w <= 0) continue; // fully-neutral article carries no signal weight
    wSum += w;
    wScoreSum += w * clamp(a.score, -1, 1);
  }

  // Not enough coverage, or all contributing articles were fully neutral → no
  // information. Report null (factor stays neutral 50), NOT a bearish 50-by-force.
  if (count < minArticles || wSum <= 0) {
    return { score: null, mean: null, count, weight: round(wSum, 6), freshestAgeDays };
  }

  const mean = clamp(wScoreSum / wSum, -1, 1);
  return {
    score: round(50 + 50 * mean, 2),
    mean: round(mean, 4),
    count,
    weight: round(wSum, 4),
    freshestAgeDays,
  };
};
