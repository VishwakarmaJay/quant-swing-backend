import { atr, round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * VolatilityFactor — ATR as a percentage of price (docs SPRINT_02: "ATR
 * percentile; feeds stop + size rules"). It is NON-directional: it does not say
 * bull or bear, so its agreementContribution is always 0. Its score is
 * favorability for a controlled-risk swing entry — calm (low ATR%) is
 * favorable, elevated volatility approaches the reject band (config
 * `rejectAtrPct`, mirroring the strategy's ATR reject/size rules).
 *
 * The ATR percentile (where current ATR sits within its own recent range) is
 * exposed as an informational metric + explanation, not a score driver — the
 * absolute ATR% is what the downstream stop/size/reject rules actually use.
 */

export type VolatilityFactorConfig = {
  atrPeriod: number;
  /** Window for the ATR percentile reading. */
  percentileLookback: number;
  /** ATR% at/below which volatility is ideal → score 100. */
  idealAtrPct: number;
  /** ATR% at/above which volatility is unfavorable → score 0 (reject band). */
  rejectAtrPct: number;
};

export const DEFAULT_VOLATILITY_CONFIG: VolatilityFactorConfig = {
  atrPeriod: 14,
  percentileLookback: 100,
  idealAtrPct: 1.5,
  rejectAtrPct: 6.0,
};

export class VolatilityFactor implements Factor {
  readonly name = 'volatility';
  readonly category = FactorCategory.VOLATILITY;

  constructor(private readonly config: VolatilityFactorConfig = DEFAULT_VOLATILITY_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { atrPeriod, percentileLookback, idealAtrPct, rejectAtrPct } = this.config;
    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);
    const closes = ctx.candles.map((c) => c.close);
    const close = closes.at(-1);

    const series = atr(highs, lows, closes, atrPeriod).filter((v) => !Number.isNaN(v));
    const latestAtr = series.at(-1);

    // Non-directional and can't assess risk without ATR → neutral, explained.
    if (latestAtr === undefined || close === undefined || !Number.isFinite(close) || close <= 0) {
      return {
        score: 50,
        agreementContribution: 0,
        explanations: [`insufficient history for ATR${atrPeriod} (have ${closes.length})`],
        metrics: { candles: closes.length },
      };
    }

    const atrPct = (latestAtr / close) * 100;

    // Favorability from absolute ATR% (ideal → 100, reject → 0, linear between).
    let score: number;
    if (atrPct <= idealAtrPct) score = 100;
    else if (atrPct >= rejectAtrPct) score = 0;
    else score = (100 * (rejectAtrPct - atrPct)) / (rejectAtrPct - idealAtrPct);
    score = round(score, 2);

    // ATR percentile (mid-rank, tie-safe) — informational context, not scored.
    const window = series.slice(-percentileLookback);
    const below = window.filter((v) => v < latestAtr).length;
    const equal = window.filter((v) => v === latestAtr).length;
    const percentile = round(((below + 0.5 * equal) / window.length) * 100, 1);

    const explanations = [
      `ATR ${round(latestAtr)} = ${round(atrPct)}% of price ${round(close)}`,
      `ATR at ${percentile}th percentile of last ${window.length} ` +
        `(${percentile >= 70 ? 'elevated' : percentile <= 30 ? 'compressed' : 'normal'} vs its own range)`,
    ];
    if (atrPct >= rejectAtrPct)
      explanations.push(`≥ reject threshold ${rejectAtrPct}% — too volatile for a swing entry`);
    else if (atrPct <= idealAtrPct)
      explanations.push('calm — favorable for a controlled-risk entry');

    return {
      score,
      agreementContribution: 0,
      explanations,
      metrics: {
        atr: round(latestAtr),
        atrPct: round(atrPct),
        atrPercentile: percentile,
        atrPeriod,
        idealAtrPct,
        rejectAtrPct,
        close: round(close),
      },
    };
  }
}
