import { lookbackReturnPct, round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * RelativeStrengthFactor — the stock's return versus the market benchmark
 * (Nifty) over a lookback (docs SPRINT_02: "vs Nifty"). Outperformance is
 * bullish (relative strength), underperformance bearish. The benchmark is
 * injected via StockContext, so evaluate stays pure and deterministic.
 *
 * Sector-relative strength (vs peers) is a planned extension — it needs a
 * cross-sectional pre-pass over the whole universe and is better computed once
 * in the pipeline than per-stock here. See DECISIONS / SPRINT notes.
 */

export type RelativeStrengthFactorConfig = {
  /** Lookback in trading days for the return comparison. */
  lookback: number;
  /** Excess return (%) vs the benchmark that earns a full score. */
  excessCapPct: number;
};

export const DEFAULT_RS_CONFIG: RelativeStrengthFactorConfig = {
  lookback: 60,
  excessCapPct: 20,
};

export class RelativeStrengthFactor implements Factor {
  readonly name = 'relativeStrength';
  readonly category = FactorCategory.RELATIVE_STRENGTH;

  constructor(private readonly config: RelativeStrengthFactorConfig = DEFAULT_RS_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { lookback, excessCapPct } = this.config;
    const closes = ctx.candles.map((c) => c.close);
    const benchCloses = ctx.benchmark?.candles.map((c) => c.close) ?? [];
    const benchSymbol = ctx.benchmark?.symbol ?? 'benchmark';

    const stockRet = lookbackReturnPct(closes, lookback);
    const benchRet = lookbackReturnPct(benchCloses, lookback);

    if (stockRet === null || benchRet === null) {
      const reason =
        benchCloses.length === 0
          ? `no ${benchSymbol} benchmark data for relative strength`
          : stockRet === null
            ? `insufficient history for RS (need ${lookback + 1}, have ${closes.length})`
            : `insufficient ${benchSymbol} history for RS (need ${lookback + 1}, have ${benchCloses.length})`;
      return {
        score: 0,
        agreementContribution: 0,
        explanations: [reason],
        metrics: { candles: closes.length },
      };
    }

    const excess = stockRet - benchRet;
    const norm = Math.max(-1, Math.min(1, excess / excessCapPct));
    const score = round(50 + norm * 50, 2);

    const explanations = [
      excess >= 0
        ? `Outperformed ${benchSymbol} by ${round(excess, 2)}% over ${lookback}d ` +
          `(stock ${round(stockRet, 2)}% vs ${benchSymbol} ${round(benchRet, 2)}%)`
        : `Underperformed ${benchSymbol} by ${round(-excess, 2)}% over ${lookback}d ` +
          `(stock ${round(stockRet, 2)}% vs ${benchSymbol} ${round(benchRet, 2)}%)`,
    ];

    return {
      score,
      agreementContribution: round(norm, 4),
      explanations,
      metrics: {
        stockReturnPct: round(stockRet, 2),
        benchmarkReturnPct: round(benchRet, 2),
        excessPct: round(excess, 2),
        benchmark: benchSymbol,
        lookback,
      },
    };
  }
}
