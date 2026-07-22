/**
 * Stationary block bootstrap (research layer, Task 4/5) — Politis & Romano
 * (1994). Confidence intervals for a statistic of a serially-correlated series
 * (daily IC, per-trade returns), where the naive iid bootstrap understates
 * variance because it ignores autocorrelation.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): nothing in the repo
 * computes a bootstrap CI — `eventStudy.cellStats` gives a normal-approximation
 * CI only, which assumes independence. This is the autocorrelation-robust
 * alternative the evidence request asks for. No ranking/candle/label logic here.
 *
 * DETERMINISM — the only randomness is a SEEDED PRNG (mulberry32); no wall-clock,
 * no `Math.random`. Same inputs + seed ⇒ same CI, every run (project rule).
 *
 * METHOD — blocks have geometrically-distributed length with mean `block`; the
 * resample wraps circularly. Default block ≈ 20 and 10k reps match the evidence
 * request. Reported CI is the [alpha/2, 1−alpha/2] percentile interval of the
 * bootstrap statistic distribution.
 */

export type BootstrapCI = {
  /** The statistic on the original series. */
  point: number;
  ciLow: number;
  ciHigh: number;
  reps: number;
  block: number;
};

export type BootstrapOptions = {
  block?: number;
  reps?: number;
  seed?: number;
  /** Two-sided level; 0.05 ⇒ 95% CI. */
  alpha?: number;
};

const DEFAULTS = { block: 20, reps: 10_000, seed: 12345, alpha: 0.05 };

/** Deterministic PRNG in [0,1). */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Percentile of an already-sorted array (linear interpolation). */
const percentileSorted = (sorted: number[], q: number): number => {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/**
 * One stationary-bootstrap resample of length `n` (circular), returned as a new
 * array. `pNewBlock = 1/block` is the per-step probability of jumping to a fresh
 * random start.
 */
const resample = (series: readonly number[], rand: () => number, pNewBlock: number): number[] => {
  const n = series.length;
  const out = new Array<number>(n);
  let idx = Math.floor(rand() * n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || rand() < pNewBlock) idx = Math.floor(rand() * n);
    else idx = (idx + 1) % n;
    out[i] = series[idx]!;
  }
  return out;
};

/**
 * Stationary block-bootstrap CI of `stat` over `series`. Returns the point
 * estimate and the percentile interval. Degenerate inputs (n<2) yield a
 * zero-width CI at the point estimate.
 */
export const blockBootstrapCI = (
  series: readonly number[],
  stat: (xs: readonly number[]) => number,
  opts: BootstrapOptions = {},
): BootstrapCI => {
  const block = opts.block ?? DEFAULTS.block;
  const reps = opts.reps ?? DEFAULTS.reps;
  const seed = opts.seed ?? DEFAULTS.seed;
  const alpha = opts.alpha ?? DEFAULTS.alpha;
  const point = series.length ? stat(series) : NaN;
  if (series.length < 2) return { point, ciLow: point, ciHigh: point, reps, block };

  const rand = mulberry32(seed);
  const pNewBlock = 1 / Math.max(1, block);
  const stats = new Array<number>(reps);
  for (let r = 0; r < reps; r++) stats[r] = stat(resample(series, rand, pNewBlock));
  stats.sort((a, b) => a - b);

  return {
    point,
    ciLow: percentileSorted(stats, alpha / 2),
    ciHigh: percentileSorted(stats, 1 - alpha / 2),
    reps,
    block,
  };
};

/** Mean — the most common statistic to bootstrap (IC mean, expectancy). */
export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
