/**
 * Signal math (docs research/TRADING_RULES). Turns a passing candidate into a
 * trade with levels: entry band, ATR/swing stop-loss, R-multiple targets, and
 * the resistance R:R check. Stop is decoupled from size (ADR: ATR→stop,
 * volatility→size); sizing is the PortfolioManager's job.
 */

export type SignalLevels = {
  /** Reference price (last close). */
  entry: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  /** entry − stopLoss (per share). */
  riskPerShare: number;
  slPct: number;
  target1: number;
  target2: number;
  /** Nearest overhead resistance (prior 60-candle high above entry), or null when clear. */
  resistance: number | null;
  rrToResistance: number | null;
  atr: number;
  atrPct: number;
};

export type SignalMathResult =
  | ({ ok: true; explanations: string[] } & SignalLevels)
  | { ok: false; reason: string; detail: string };

export type SignalMathConfig = {
  atrPeriod: number;
  /** atrPct below this → wide multiplier, at/above → tight (docs atr-buckets). */
  atrBucketThreshold: number;
  atrMultBelow: number;
  atrMultAbove: number;
  swingLookback: number;
  swingBuffer: number;
  slMinPct: number;
  slMaxPct: number;
  /** Entry band half-width (%) around the reference price. */
  entryBandPct: number;
  /** Target R-multiples [T1, T2]. */
  targetRr: [number, number];
  resistanceLookback: number;
  /** Reject when R:R to the nearest resistance is below this. */
  minResistanceRr: number;
  /** atrPct at/above which the trade is rejected outright. */
  atrRejectPct: number;
};

export const DEFAULT_SIGNAL_MATH_CONFIG: SignalMathConfig = {
  atrPeriod: 14,
  atrBucketThreshold: 1.5,
  atrMultBelow: 2.0,
  atrMultAbove: 1.5,
  swingLookback: 15,
  swingBuffer: 0.997,
  slMinPct: 0.5,
  slMaxPct: 3.0,
  entryBandPct: 0.5,
  targetRr: [2.0, 3.0],
  resistanceLookback: 60,
  minResistanceRr: 1.5,
  atrRejectPct: 6.0,
};
