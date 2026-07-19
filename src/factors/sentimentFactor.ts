import {
  aggregateSentiment,
  DEFAULT_SENTIMENT_AGGREGATE_CONFIG,
  type SentimentAggregateConfig,
} from '@/news/sentimentAggregate';

import { round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * SentimentFactor (ROADMAP B7) — scores a stock's news sentiment as-of the
 * evaluation date from the FinBERT-scored archive (B3/B6). The point-in-time
 * article set (`availableAt ≤ asOf`, within the window) is injected via
 * `ctx.sentiment` by a cross-sectional pre-pass; scoring is the pure
 * `aggregateSentiment` core (recency + confidence weighted, chase-decay) — so
 * `evaluate` stays deterministic and golden-testable like every other factor.
 *
 * No data / thin coverage → neutral 50, agreement 0 (the same missing-data
 * convention as the fundamental factor). Thin-coverage-neutral deliberately
 * biases toward well-covered large caps — a documented B7 limitation.
 *
 * OBSERVATIONAL until walk-forward evidence: this factor computes into every
 * FeatureBundle but the frozen baseline keeps `buckets.sentiment: []`, so the
 * composite is byte-identical until the bucket is consciously activated (B9).
 */

export type SentimentFactorConfig = {
  aggregate: SentimentAggregateConfig;
};

export const DEFAULT_SENTIMENT_CONFIG: SentimentFactorConfig = {
  aggregate: DEFAULT_SENTIMENT_AGGREGATE_CONFIG,
};

/** Neutral, no-information output (no lean either way). */
const neutral = (reason: string, extra: Record<string, number | string | boolean> = {}): FactorOutput => ({
  score: 50,
  agreementContribution: 0,
  explanations: [reason],
  metrics: { ...extra },
});

export class SentimentFactor implements Factor {
  readonly name = 'sentiment';
  readonly category = FactorCategory.SENTIMENT;

  constructor(private readonly config: SentimentFactorConfig = DEFAULT_SENTIMENT_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const s = ctx.sentiment;
    if (!s || s.articles.length === 0) {
      return neutral('no news sentiment as of this date — neutral');
    }

    const agg = aggregateSentiment(s.articles, this.config.aggregate);
    const metrics: Record<string, number | string | boolean> = {
      articleCount: agg.count,
      sentimentWeight: agg.weight,
    };
    if (agg.freshestAgeDays !== null) metrics.freshestAgeDays = round(agg.freshestAgeDays, 2);

    if (agg.score === null) {
      return neutral(
        `insufficient sentiment signal (${agg.count} article(s) in window, weight ${agg.weight}) — neutral`,
        metrics,
      );
    }

    metrics.sentimentMean = agg.mean!;
    return {
      score: agg.score,
      // Same convention as the other factors: directional lean in [−1, 1].
      agreementContribution: round((agg.score - 50) / 50, 4),
      explanations: [
        `sentiment ${agg.score} from ${agg.count} article(s) (weighted mean ${agg.mean}, ` +
          `freshest ${agg.freshestAgeDays}d old)`,
      ],
      metrics,
    };
  }
}
