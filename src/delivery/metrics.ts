/**
 * Delivery-signal math (B13). PURE — no I/O, no clock.
 *
 * Two candidate readings of the same daily number, and they are NOT equivalent:
 *
 *  - **Level** (`deliveryPct`): how much of today's volume settled as delivery.
 *    Weak as a cross-sectional signal on its own, because delivery level is
 *    strongly structural — a utility or an insurer sits near 60–70% every day, a
 *    high-churn momentum name near 25%. Ranking on the level mostly ranks
 *    *sector and shareholding structure*, not accumulation.
 *
 *  - **Surge** (`deliveryPct ÷ its own trailing mean`): today's delivery
 *    relative to what this stock normally does. This is the accumulation
 *    hypothesis proper — someone is taking delivery unusually hard *for this
 *    name*. It is the same "relative to its own baseline" idea that made
 *    SectorRelativeStrength the first orthogonal factor that helped.
 *
 * The study measures both, so the level acts as the control for the surge.
 *
 * POINT-IN-TIME: `surgeAsOf` uses only days STRICTLY BEFORE the as-of index for
 * the baseline, and the as-of day itself for the numerator. The bhavcopy for day
 * D publishes after D's close, so D's own delivery is known at D's close — the
 * same instant as D's candle. No lookahead.
 */

export type DeliveryPoint = { tradeDate: string; deliveryPct: number; tradedQty: number };

/**
 * Delivery surge at `index`: that day's delivery % divided by the mean of the
 * previous `lookback` days. 1.0 = normal for this stock, 2.0 = twice its usual.
 * Null when there is not a full baseline — never a partial-window guess.
 */
export const surgeAsOf = (series: DeliveryPoint[], index: number, lookback = 20): number | null => {
  if (index < lookback || index >= series.length) return null;
  let sum = 0;
  for (let i = index - lookback; i < index; i++) {
    const p = series[i];
    if (!p) return null;
    sum += p.deliveryPct;
  }
  const baseline = sum / lookback;
  if (baseline <= 0) return null;
  const today = series[index];
  if (!today) return null;
  return today.deliveryPct / baseline;
};

/**
 * Volume surge at `index` — the same shape for traded quantity. Delivery % can
 * rise simply because total volume collapsed, so a "delivery surge" on thin
 * volume is not accumulation. Pairing the two separates the cases.
 */
export const volumeSurgeAsOf = (series: DeliveryPoint[], index: number, lookback = 20): number | null => {
  if (index < lookback || index >= series.length) return null;
  let sum = 0;
  for (let i = index - lookback; i < index; i++) {
    const p = series[i];
    if (!p) return null;
    sum += p.tradedQty;
  }
  const baseline = sum / lookback;
  if (baseline <= 0) return null;
  const today = series[index];
  if (!today) return null;
  return today.tradedQty / baseline;
};

/**
 * Splits values into `n` equal-count buckets by rank (deciles by default),
 * returning each item's bucket index 0..n-1 (0 = lowest).
 *
 * Cross-sectional bucketing PER DAY is what makes this a fair test: it removes
 * the market-wide component automatically, so a decile spread cannot be a
 * rising-tide artifact. Ties are broken by input order, deterministically.
 */
export const bucketByRank = <T>(items: readonly T[], valueOf: (t: T) => number, n = 10): Map<T, number> => {
  const sorted = [...items]
    .map((item, i) => ({ item, v: valueOf(item), i }))
    .sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Map<T, number>();
  const size = sorted.length;
  if (size === 0) return out;
  sorted.forEach((entry, rank) => {
    const bucket = Math.min(n - 1, Math.floor((rank * n) / size));
    out.set(entry.item, bucket);
  });
  return out;
};
