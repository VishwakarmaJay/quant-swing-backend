import { atr, emaLatest, round } from '@/factors/indicators';

import {
  DEFAULT_REGIME_CONFIG,
  MarketRegime,
  type RegimeConfig,
  type RegimeInput,
  type RegimeResult,
} from './types';

/**
 * Pure market-regime classifier. Deterministic — same input → same regime.
 * Priority: CRASH (sharp Nifty drop or extreme VIX) → HIGH_VOL (elevated VIX,
 * or Nifty ATR% when VIX is absent) → trend + breadth (BULL / BEAR / SIDEWAYS).
 */
export const detectRegime = (
  input: RegimeInput,
  config: RegimeConfig = DEFAULT_REGIME_CONFIG,
): RegimeResult => {
  const closes = input.niftyCandles.map((c) => c.close);
  const highs = input.niftyCandles.map((c) => c.high);
  const lows = input.niftyCandles.map((c) => c.low);
  const close = closes.at(-1);

  const emaTrend = emaLatest(closes, config.trendEmaPeriod);
  const emaFast = emaLatest(closes, config.fastEmaPeriod);
  const vix = input.vix ?? null;
  const breadthPct = round(input.breadthPct, 1);

  if (close === undefined || emaTrend === null || emaFast === null) {
    return {
      regime: MarketRegime.SIDEWAYS,
      explanations: [`insufficient Nifty history for regime (need ${config.trendEmaPeriod})`],
      metrics: { breadthPct, vix },
    };
  }

  const prevClose = closes.at(-2) ?? close;
  const return1d = round(((close - prevClose) / prevClose) * 100, 2);

  const atrSeries = atr(highs, lows, closes, config.atrPeriod).filter((v) => !Number.isNaN(v));
  const atrLatest = atrSeries.at(-1) ?? 0;
  const niftyAtrPct = close > 0 ? round((atrLatest / close) * 100, 2) : 0;

  let regime: MarketRegime;
  const explanations: string[] = [];

  if (return1d <= -config.crashDropPct || (vix !== null && vix >= config.crashVix)) {
    regime = MarketRegime.CRASH;
    explanations.push(
      return1d <= -config.crashDropPct
        ? `Nifty ${return1d}% today (≤ -${config.crashDropPct}%) — CRASH: no new signals`
        : `VIX ${vix} ≥ ${config.crashVix} — CRASH: no new signals`,
    );
  } else if (
    (vix !== null && vix >= config.highVolVix) ||
    (vix === null && niftyAtrPct >= config.highVolAtrPct)
  ) {
    regime = MarketRegime.HIGH_VOL;
    explanations.push(
      vix !== null
        ? `VIX ${vix} ≥ ${config.highVolVix} — elevated volatility`
        : `Nifty ATR ${niftyAtrPct}% ≥ ${config.highVolAtrPct}% (VIX unavailable) — elevated volatility`,
    );
  } else {
    const aboveTrend = close > emaTrend;
    if (aboveTrend && breadthPct >= config.bullBreadthPct) {
      regime = MarketRegime.BULL;
      explanations.push(
        `Nifty above EMA${config.trendEmaPeriod} & breadth ${breadthPct}% ≥ ${config.bullBreadthPct}%`,
      );
    } else if (!aboveTrend && breadthPct <= config.bearBreadthPct) {
      regime = MarketRegime.BEAR;
      explanations.push(
        `Nifty below EMA${config.trendEmaPeriod} & breadth ${breadthPct}% ≤ ${config.bearBreadthPct}%`,
      );
    } else {
      regime = MarketRegime.SIDEWAYS;
      explanations.push(
        `Nifty ${aboveTrend ? 'above' : 'below'} EMA${config.trendEmaPeriod}, breadth ${breadthPct}% — mixed`,
      );
    }
  }

  return {
    regime,
    explanations,
    metrics: {
      niftyClose: round(close),
      niftyEmaTrend: round(emaTrend),
      niftyEmaFast: round(emaFast),
      return1d,
      breadthPct,
      niftyAtrPct,
      vix,
    },
  };
};
