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

/** Round to `dp` decimal places (keeps metrics/scores tidy and stable). */
export const round = (n: number, dp = 2): number => Number(n.toFixed(dp));
