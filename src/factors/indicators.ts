/**
 * Pure technical-indicator math. In-house (no external TA dependency) so the
 * exact computation is versioned, auditable, and deterministic — the golden
 * dataset tests will pin these outputs. Every function is a pure function of
 * its inputs; extend as each factor needs a new indicator.
 */

/**
 * Exponential moving average, SMA-seeded. Returns an array aligned to `values`;
 * entries before index `period − 1` are NaN (insufficient history). Deterministic.
 */
export const ema = (values: readonly number[], period: number): number[] => {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = (values[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
};

/** Latest EMA value, or null when there is not enough history. */
export const emaLatest = (values: readonly number[], period: number): number | null => {
  if (period <= 0 || values.length < period) return null;
  const series = ema(values, period);
  const last = series[series.length - 1]!;
  return Number.isNaN(last) ? null : last;
};

/** Simple moving average of the last `period` values, or null if too short. */
export const smaLatest = (values: readonly number[], period: number): number | null => {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!;
  return sum / period;
};

/**
 * Latest RSI (Wilder's smoothing), 0–100, or null with insufficient history.
 * Needs `period + 1` values (period price changes to seed). A zero average
 * loss yields 100 (pure gains); a zero average gain yields 0.
 */
export const rsiLatest = (values: readonly number[], period: number): number | null => {
  if (period <= 0 || values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export type Macd = { macd: number; signal: number; histogram: number };

/**
 * Latest MACD line, signal line, and histogram, or null with insufficient
 * history. MACD = EMAfast − EMAslow; signal = EMA(MACD, signalPeriod);
 * histogram = MACD − signal. Needs `slow + signal − 1` values.
 */
export const macdLatest = (
  values: readonly number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): Macd | null => {
  if (fastPeriod >= slowPeriod || values.length < slowPeriod + signalPeriod - 1) return null;

  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);

  // MACD line is defined once the slow EMA is (index slowPeriod − 1 onward).
  const macdLine: number[] = [];
  for (let i = slowPeriod - 1; i < values.length; i++) macdLine.push(fast[i]! - slow[i]!);
  if (macdLine.length < signalPeriod) return null;

  const signalSeries = ema(macdLine, signalPeriod);
  const macd = macdLine[macdLine.length - 1]!;
  const signal = signalSeries[signalSeries.length - 1]!;
  if (Number.isNaN(macd) || Number.isNaN(signal)) return null;

  return { macd, signal, histogram: macd - signal };
};

/** Round to `dp` decimal places (keeps metrics/scores tidy and stable). */
export const round = (n: number, dp = 2): number => Number(n.toFixed(dp));
