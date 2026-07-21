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
 * next to adjusted ones would make a split look like a crash. The fix reads off
 * one bhavcopy row: NSE stamps `PREV_CLOSE` with the **raw** prior-session close
 * (verified — it is NOT split-adjusted), so on a split/bonus ex-date `PREV_CLOSE`
 * is the pre-split level while `OPEN` is already post-split. The ratio
 * `PREV_CLOSE / OPEN` is therefore the corp-action factor (NAUKRI 1:5 → 6984/1387
 * ≈ 5.03), and it is **self-contained per row** — robust to the archive's missing
 * days, unlike a cross-row comparison. `backAdjustSplits` back-adjusts the
 * pre-action prices to the post-action scale, matching the Angel convention,
 * without any external split table.
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
  /** PREV_CLOSE[D] / OPEN[D] — >1 for a split/bonus, <1 for a consolidation. */
  ratio: number;
};

/**
 * Minimum |ratio − 1| that counts as a split/bonus rather than an ordinary
 * overnight gap. Real splits/bonuses gap the ex-date open far from the raw prior
 * close (2:1 → 1.0, 1:1 bonus → 1.0, 3:2 bonus → 0.5, 1:5 split → 4.0); a
 * catastrophic news gap on a liquid midcap is rarely ≥35%, so 0.35 catches every
 * common split/bonus while leaving ordinary gaps (and small 5:4-type bonuses)
 * alone. Dividends do not move OPEN vs PREV_CLOSE materially and are left in
 * (price series, not total-return — the Angel convention per the B4 audit).
 */
export const SPLIT_THRESHOLD = 0.35;

/**
 * Detects corp actions from the per-row PREV_CLOSE/OPEN gap and back-adjusts the
 * pre-action OHLCV so the whole series is on the latest (post-action) scale — the
 * same back-adjusted convention as the Angel candles.
 *
 * Rows must be ascending by date. Detection is self-contained per row (no
 * cross-row comparison), so it is robust to the bhavcopy archive's missing days.
 * Returns the adjusted rows plus the events found. Volume is inversely adjusted
 * so share count and turnover stay consistent across the action.
 */
export const backAdjustSplits = (
  rows: readonly BhavOhlcvRow[],
): { rows: BhavOhlcvRow[]; events: SplitEvent[] } => {
  if (rows.length < 2) return { rows: [...rows], events: [] };

  // First pass: find each ex-date and its factor from PREV_CLOSE/OPEN (both raw,
  // from the same row — PREV_CLOSE is pre-split, OPEN is already post-split).
  const events: SplitEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { prevClose, open } = rows[i]!;
    if (prevClose <= 0 || open <= 0) continue;
    const ratio = prevClose / open; // >1 split/bonus, <1 consolidation
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
