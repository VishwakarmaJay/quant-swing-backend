import type { Candle } from '@/ohlcv';

/**
 * Market regime (docs SYSTEM_PIPELINE / STRATEGIES). Drives the strategy's
 * regime weight matrix. CRASH is an override — no new signals, exit checks
 * only. The four weighted regimes (BULL/SIDEWAYS/HIGH_VOL/BEAR) match the
 * configured weight table.
 */
export const MarketRegime = {
  BULL: 'BULL',
  SIDEWAYS: 'SIDEWAYS',
  BEAR: 'BEAR',
  HIGH_VOL: 'HIGH_VOL',
  CRASH: 'CRASH',
} as const;
export type MarketRegime = (typeof MarketRegime)[keyof typeof MarketRegime];

/** Inputs to the pure regime detector. Breadth is precomputed by the service
 *  (it needs the whole universe); VIX is optional until the VIX feed exists. */
export type RegimeInput = {
  asOf: string;
  /** Nifty (benchmark) daily candles, ascending, ≤ asOf. */
  niftyCandles: readonly Candle[];
  /** % of the universe trading above its fast EMA (0–100). */
  breadthPct: number;
  /** India VIX, or null when unavailable (proxy used instead). */
  vix?: number | null;
};

export type RegimeResult = {
  regime: MarketRegime;
  explanations: string[];
  metrics: Record<string, number | string | null>;
};

export type RegimeConfig = {
  trendEmaPeriod: number;
  fastEmaPeriod: number;
  /** Breadth ≥ this with Nifty above trend EMA → BULL. */
  bullBreadthPct: number;
  /** Breadth ≤ this with Nifty below trend EMA → BEAR. */
  bearBreadthPct: number;
  /** Nifty 1-day drop (%) at/below which the regime is CRASH. */
  crashDropPct: number;
  /** VIX at/above which the regime is CRASH (if VIX available). */
  crashVix: number;
  /** VIX at/above which the regime is HIGH_VOL (if VIX available). */
  highVolVix: number;
  /** Nifty ATR% at/above which the regime is HIGH_VOL when VIX is absent. */
  highVolAtrPct: number;
  atrPeriod: number;
};

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  trendEmaPeriod: 200,
  fastEmaPeriod: 50,
  bullBreadthPct: 55,
  bearBreadthPct: 40,
  crashDropPct: 3.0,
  crashVix: 30,
  highVolVix: 20,
  highVolAtrPct: 2.0,
  atrPeriod: 14,
};
