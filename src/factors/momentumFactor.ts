import { macdLatest, rsiLatest, round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * MomentumFactor — MACD + RSI combined (docs SPRINT_02). Two sub-scores:
 *  - MACD: +50 above the zero line (established trend), +50 histogram > 0
 *    (rising vs its signal) → 0/50/100.
 *  - RSI: used directly as a momentum reading (higher = stronger). Overbought
 *    exclusion is the strategy's job (its RSI gate), not this factor's — a
 *    momentum factor should report strong momentum, not mean-revert it.
 * Blended by config weights. Deterministic; no hardcoded numerics.
 */

export type MomentumFactorConfig = {
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  /** Blend of the two sub-scores; should sum to 1. */
  weights: { macd: number; rsi: number };
};

export const DEFAULT_MOMENTUM_CONFIG: MomentumFactorConfig = {
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  weights: { macd: 0.5, rsi: 0.5 },
};

export class MomentumFactor implements Factor {
  readonly name = 'momentum';
  readonly category = FactorCategory.MOMENTUM;

  constructor(private readonly config: MomentumFactorConfig = DEFAULT_MOMENTUM_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { rsiPeriod, macdFast, macdSlow, macdSignal, weights } = this.config;
    const closes = ctx.candles.map((c) => c.close);

    const rsi = rsiLatest(closes, rsiPeriod);
    const macd = macdLatest(closes, macdFast, macdSlow, macdSignal);

    // Previous-bar readings, so downstream logic can detect momentum turning up
    // (e.g. a pullback resuming). Fall back to the current value when the series
    // is one bar too short → slope reads flat (not rising), failing safe.
    const rsiPrevRaw = rsiLatest(closes.slice(0, -1), rsiPeriod);
    const macdPrevRaw = macdLatest(closes.slice(0, -1), macdFast, macdSlow, macdSignal);

    if (rsi === null || macd === null) {
      return {
        score: 0,
        agreementContribution: 0,
        explanations: [
          `insufficient history for momentum (need ~${macdSlow + macdSignal}, have ${closes.length})`,
        ],
        metrics: { candles: closes.length },
      };
    }

    const macdScore = (macd.macd > 0 ? 50 : 0) + (macd.histogram > 0 ? 50 : 0);
    const rsiScore = Math.max(0, Math.min(100, rsi));
    const score = round(weights.macd * macdScore + weights.rsi * rsiScore, 2);

    const macdBull = macd.histogram > 0;
    const explanations = [
      macdBull
        ? `MACD ${round(macd.macd)} above signal ${round(macd.signal)} (bullish)${macd.macd > 0 ? ', above zero' : ''}`
        : `MACD ${round(macd.macd)} below signal ${round(macd.signal)} (bearish)${macd.macd < 0 ? ', below zero' : ''}`,
      `RSI ${round(rsi)} ${
        rsi >= 70 ? '(overbought)' : rsi >= 50 ? '(bullish momentum)' : rsi >= 30 ? '(weak momentum)' : '(oversold)'
      }`,
    ];

    return {
      score,
      agreementContribution: round((score - 50) / 50, 4),
      explanations,
      metrics: {
        rsi: round(rsi),
        macd: round(macd.macd),
        signal: round(macd.signal),
        histogram: round(macd.histogram),
        rsiPrev: round(rsiPrevRaw ?? rsi),
        histogramPrev: round(macdPrevRaw?.histogram ?? macd.histogram),
        rsiPeriod,
        macdFast,
        macdSlow,
        macdSignal,
      },
    };
  }
}
