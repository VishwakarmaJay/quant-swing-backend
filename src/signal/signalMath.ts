import { atr, round } from '@/factors/indicators';
import type { Candle } from '@/ohlcv';

import { DEFAULT_SIGNAL_MATH_CONFIG, type SignalMathConfig, type SignalMathResult } from './types';

/**
 * Computes trade levels for a candidate (docs TRADING_RULES). Pure and
 * deterministic. Rejections (which realize strategy gate 6 and the ATR/SL
 * guards): `atr-too-high`, `sl-band`, `rr-resistance`, `insufficient-history`.
 *
 *   SL_ATR   = entry − mult × ATR   (mult by ATR% bucket)
 *   SL_SWING = min(low, 15) × 0.997
 *   SL       = max(SL_ATR, SL_SWING)          — tighter of the two
 *   targets  = entry + {2,3} × risk
 *   resistance = prior 60-candle high above entry (null on a breakout)
 */
export const computeSignalLevels = (
  candles: readonly Candle[],
  config: SignalMathConfig = DEFAULT_SIGNAL_MATH_CONFIG,
): SignalMathResult => {
  const need = Math.max(config.atrPeriod + 1, config.resistanceLookback, config.swingLookback);
  if (candles.length < need) {
    return { ok: false, reason: 'insufficient-history', detail: `need ${need} candles, have ${candles.length}` };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const entry = closes.at(-1)!;

  const atrSeries = atr(highs, lows, closes, config.atrPeriod).filter((v) => !Number.isNaN(v));
  const atrVal = atrSeries.at(-1);
  if (atrVal === undefined || !(entry > 0)) {
    return { ok: false, reason: 'insufficient-history', detail: 'no usable ATR/price' };
  }
  const atrPct = round((atrVal / entry) * 100, 2);

  if (atrPct >= config.atrRejectPct) {
    return { ok: false, reason: 'atr-too-high', detail: `ATR ${atrPct}% ≥ ${config.atrRejectPct}%` };
  }

  const mult = atrPct < config.atrBucketThreshold ? config.atrMultBelow : config.atrMultAbove;
  const slAtr = entry - mult * atrVal;
  const swingLow = Math.min(...lows.slice(-config.swingLookback));
  const slSwing = swingLow * config.swingBuffer;
  const stopLoss = round(Math.max(slAtr, slSwing), 2);
  const riskPerShare = round(entry - stopLoss, 2);
  const slPct = round(((entry - stopLoss) / entry) * 100, 2);

  if (slPct < config.slMinPct || slPct > config.slMaxPct) {
    return { ok: false, reason: 'sl-band', detail: `SL ${slPct}% outside [${config.slMinPct}, ${config.slMaxPct}]%` };
  }

  const target1 = round(entry + config.targetRr[0] * riskPerShare, 2);
  const target2 = round(entry + config.targetRr[1] * riskPerShare, 2);

  // Nearest overhead resistance: highest PRIOR high (exclude the current bar).
  const priorHighs = highs.slice(-config.resistanceLookback, -1);
  const maxPrior = priorHighs.length ? Math.max(...priorHighs) : 0;
  const resistance = maxPrior > entry ? round(maxPrior, 2) : null;
  const rrToResistance = resistance !== null ? round((resistance - entry) / riskPerShare, 2) : null;

  if (rrToResistance !== null && rrToResistance < config.minResistanceRr) {
    return {
      ok: false,
      reason: 'rr-resistance',
      detail: `R:R to resistance ${rrToResistance} < ${config.minResistanceRr}`,
    };
  }

  const entryLow = round(entry * (1 - config.entryBandPct / 100), 2);
  const entryHigh = round(entry * (1 + config.entryBandPct / 100), 2);

  return {
    ok: true,
    entry: round(entry, 2),
    entryLow,
    entryHigh,
    stopLoss,
    riskPerShare,
    slPct,
    target1,
    target2,
    resistance,
    rrToResistance,
    atr: round(atrVal, 2),
    atrPct,
    explanations: [
      `Entry ${entryLow}–${entryHigh}, SL ${stopLoss} (${slPct}%), T1 ${target1}, T2 ${target2}` +
        (resistance !== null ? `, resistance ${resistance} (R:R ${rrToResistance})` : ', clear overhead'),
    ],
  };
};
