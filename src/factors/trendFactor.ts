import { emaLatest, round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * TrendFactor — the EMA 20/50/200 stack (docs SPRINT_02). Scores how cleanly
 * price is stacked above its moving averages: a full bullish stack
 * (price > EMAfast > EMAmid > EMAslow) is maximally bullish; the inverse is
 * maximally bearish. Deterministic; all numerics come from config, not literals.
 */

export type TrendFactorConfig = {
  fastPeriod: number;
  midPeriod: number;
  slowPeriod: number;
  /** Points per satisfied condition; should sum to 100. */
  weights: {
    priceAboveFast: number;
    fastAboveMid: number;
    midAboveSlow: number;
    priceAboveSlow: number;
  };
};

export const DEFAULT_TREND_CONFIG: TrendFactorConfig = {
  fastPeriod: 20,
  midPeriod: 50,
  slowPeriod: 200,
  weights: { priceAboveFast: 25, fastAboveMid: 25, midAboveSlow: 25, priceAboveSlow: 25 },
};

export class TrendFactor implements Factor {
  readonly name = 'trend';
  readonly category = FactorCategory.TREND;

  constructor(private readonly config: TrendFactorConfig = DEFAULT_TREND_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { fastPeriod, midPeriod, slowPeriod, weights } = this.config;
    const closes = ctx.candles.map((c) => c.close);
    const close = closes.at(-1);

    const emaFast = emaLatest(closes, fastPeriod);
    const emaMid = emaLatest(closes, midPeriod);
    const emaSlow = emaLatest(closes, slowPeriod);

    // Insufficient history for the slowest EMA → neutral-low, explained.
    if (
      close === undefined ||
      !Number.isFinite(close) ||
      emaFast === null ||
      emaMid === null ||
      emaSlow === null
    ) {
      return {
        score: 0,
        agreementContribution: 0,
        explanations: [
          `insufficient history for EMA${slowPeriod} (have ${closes.length}, need ${slowPeriod})`,
        ],
        metrics: { candles: closes.length, required: slowPeriod },
      };
    }

    const cond = {
      priceAboveFast: close > emaFast,
      fastAboveMid: emaFast > emaMid,
      midAboveSlow: emaMid > emaSlow,
      priceAboveSlow: close > emaSlow,
    };

    let score = 0;
    if (cond.priceAboveFast) score += weights.priceAboveFast;
    if (cond.fastAboveMid) score += weights.fastAboveMid;
    if (cond.midAboveSlow) score += weights.midAboveSlow;
    if (cond.priceAboveSlow) score += weights.priceAboveSlow;

    const explanations: string[] = [];
    if (cond.priceAboveFast && cond.fastAboveMid && cond.midAboveSlow) {
      explanations.push(
        `Bullish EMA stack: price ${round(close)} > EMA${fastPeriod} ${round(emaFast)} > ` +
          `EMA${midPeriod} ${round(emaMid)} > EMA${slowPeriod} ${round(emaSlow)}`,
      );
    } else if (!cond.priceAboveFast && !cond.fastAboveMid && !cond.midAboveSlow) {
      explanations.push(
        `Bearish EMA stack: price ${round(close)} < EMA${fastPeriod} ${round(emaFast)} < ` +
          `EMA${midPeriod} ${round(emaMid)} < EMA${slowPeriod} ${round(emaSlow)}`,
      );
    } else {
      explanations.push(
        cond.priceAboveFast
          ? `Price ${round(close)} above EMA${fastPeriod} ${round(emaFast)}`
          : `Price ${round(close)} below EMA${fastPeriod} ${round(emaFast)}`,
      );
      explanations.push(
        cond.midAboveSlow
          ? `EMA${midPeriod} above EMA${slowPeriod} (uptrend base)`
          : `EMA${midPeriod} below EMA${slowPeriod} (downtrend base)`,
      );
    }

    return {
      score,
      // Map 0–100 → −1…+1 directional lean for the strategy's agreement metric.
      agreementContribution: round((score - 50) / 50, 4),
      explanations,
      metrics: {
        close: round(close),
        emaFast: round(emaFast),
        emaMid: round(emaMid),
        emaSlow: round(emaSlow),
        fastPeriod,
        midPeriod,
        slowPeriod,
      },
    };
  }
}
