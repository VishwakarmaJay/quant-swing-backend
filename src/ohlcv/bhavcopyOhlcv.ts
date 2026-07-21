/**
 * Bhavcopy → OHLCV extraction + corporate-action back-adjustment (survivorship
 * repair, docs/SURVIVORSHIP.md). PURE — no I/O, no clock.
 *
 * The B13 parser (`src/delivery/bhavcopy.ts`) keeps only the delivery fields;
 * the survivorship repair needs OHLC for names that have since delisted and are
 * therefore absent from Angel One's *current* scrip master. NSE's full bhavcopy
 * carries them on every day they traded.
 *
 * ⚠️ THE WRINKLE this module exists to handle: Angel candles are corp-action
 * ADJUSTED (verified, B4 audit); bhavcopy prices are RAW. Splicing raw series
 * next to adjusted ones would make a split look like a crash. Bhavcopy itself
 * carries the fix: on a split/bonus ex-date the exchange stamps `PREV_CLOSE`
 * with the *adjusted* prior close, so a discontinuity between `CLOSE[D-1]` and
 * `PREV_CLOSE[D]` reveals the action and its ratio. `backAdjustSplits` uses that
 * to back-adjust the pre-action prices, producing a continuous series in the
 * same convention as the Angel candles — without any external split table.
 *
 * Columns (0-indexed): 0 SYMBOL · 1 SERIES · 2 DATE1 · 3 PREV_CLOSE ·
 *   4 OPEN · 5 HIGH · 6 LOW · 7 LAST · 8 CLOSE · 9 AVG · 10 TTL_TRD_QNTY · … ·
 *   14 DELIV_PER. Every field carries a leading space; symbols are canonical.
 */

import { parseBhavDate } from '@/delivery/bhavcopy';

export type BhavOhlcvRow = {
  symbol: string;
  /** ISO date (YYYY-MM-DD). */
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Exchange-stamped previous close — corp-action-adjusted on ex-dates. */
  prevClose: number;
  volume: number;
};

const num = (raw: string | undefined): number | null => {
  const t = (raw ?? '').replace(/[\s\r]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parses a full-bhavcopy CSV into EQ-series OHLC rows for the wanted symbols
 * (or all EQ rows when `wanted` is omitted). Malformed rows are skipped, never
 * thrown — one bad line must not cost a day's file. OHLC must be strictly
 * positive and `high >= low` or the row is dropped as corrupt.
 */
export const parseBhavcopyOhlcv = (
  csv: string,
  wanted?: ReadonlySet<string>,
): { rows: BhavOhlcvRow[]; skipped: number } => {
  const lines = csv.split('\n');
  const rows: BhavOhlcvRow[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const f = line.split(',');
    if (f.length < 15) {
      skipped++;
      continue;
    }
    if ((f[1] ?? '').replace(/[\s\r]/g, '') !== 'EQ') continue;

    const symbol = (f[0] ?? '').replace(/[\s\r]/g, '');
    if (wanted && !wanted.has(symbol)) continue;

    const tradeDate = parseBhavDate(f[2] ?? '');
    const prevClose = num(f[3]);
    const open = num(f[4]);
    const high = num(f[5]);
    const low = num(f[6]);
    const close = num(f[8]);
    const volume = num(f[10]);

    if (!symbol || !tradeDate || open == null || high == null || low == null || close == null) {
      skipped++;
      continue;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < low) {
      skipped++;
      continue;
    }

    rows.push({
      symbol,
      tradeDate,
      open,
      high,
      low,
      close,
      prevClose: prevClose ?? close,
      volume: volume ?? 0,
    });
  }
  return { rows, skipped };
};

/** A detected corporate action within a raw series. */
export type SplitEvent = {
  /** Ex-date (the first day priced on the new, post-action scale). */
  exDate: string;
  /** CLOSE[D-1] / PREV_CLOSE[D] — >1 for a split/bonus, <1 for a consolidation. */
  ratio: number;
};

/**
 * Minimum |ratio − 1| that counts as a split/bonus rather than an ordinary
 * dividend. A 20% single-day PREV_CLOSE gap is far larger than any dividend
 * yield but comfortably below the smallest common split (1:4 bonus = +25%,
 * ratio 1.25 → 0.80). Ordinary/special dividends adjust PREV_CLOSE by a few
 * percent at most and are deliberately left in (matching a price series, not a
 * total-return series — the Angel convention per the B4 audit).
 */
export const SPLIT_THRESHOLD = 0.2;

/**
 * Detects corp actions from PREV_CLOSE/CLOSE discontinuities and back-adjusts
 * the pre-action OHLCV so the whole series is on the latest (post-action) scale
 * — the same back-adjusted convention as the Angel candles.
 *
 * Rows must be ascending by date. Returns the adjusted rows plus the events
 * found (for logging/auditing). Volume is inversely adjusted so share count and
 * turnover stay consistent across the action.
 */
export const backAdjustSplits = (
  rows: readonly BhavOhlcvRow[],
): { rows: BhavOhlcvRow[]; events: SplitEvent[] } => {
  if (rows.length < 2) return { rows: [...rows], events: [] };

  // First pass (ascending): find each ex-date and its ratio.
  const events: SplitEvent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prevClose = rows[i]!.prevClose;
    const lastClose = rows[i - 1]!.close;
    if (prevClose <= 0 || lastClose <= 0) continue;
    const ratio = lastClose / prevClose; // >1 split/bonus, <1 consolidation
    if (Math.abs(ratio - 1) >= SPLIT_THRESHOLD) {
      events.push({ exDate: rows[i]!.tradeDate, ratio });
    }
  }
  if (events.length === 0) return { rows: rows.map((r) => ({ ...r })), events };

  // Second pass (descending): the ex-date row is ALREADY on the new scale, so
  // apply the current factor to each row FIRST, then fold the event in so it
  // only touches strictly-earlier days. Walking backwards compounds multiple
  // actions naturally.
  const byExDate = new Map(events.map((e) => [e.exDate, e.ratio] as const));
  const out = rows.map((r) => ({ ...r }));
  let priceFactor = 1; // divides pre-action prices onto the latest scale
  let volFactor = 1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (priceFactor !== 1) {
      const r = out[i]!;
      r.open *= priceFactor;
      r.high *= priceFactor;
      r.low *= priceFactor;
      r.close *= priceFactor;
      r.prevClose *= priceFactor;
      r.volume *= volFactor;
    }
    const ev = byExDate.get(out[i]!.tradeDate);
    if (ev != null) {
      priceFactor *= 1 / ev; // earlier days move onto this action's post-scale
      volFactor *= ev;
    }
  }
  return { rows: out, events };
};
