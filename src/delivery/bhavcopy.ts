/**
 * NSE "security bhavcopy (full)" parser (B13). PURE — no I/O, no clock.
 *
 * The file NSE publishes daily after close carries the one number no price feed
 * has: **delivery percentage** — the share of traded volume that actually
 * settled as delivery rather than being squared off intraday. It is the closest
 * free proxy for institutional accumulation, and the architecture review ranked
 * it the highest alpha-per-effort free source we had not touched.
 *
 * Format (live-verified 2026-07-20, files available back to at least 2021):
 *   SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE,
 *   LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS,
 *   NO_OF_TRADES, DELIV_QTY, DELIV_PER
 *
 * Quirks handled: every field carries a leading space; non-EQ series (GS/BE/SM/
 * ST) may carry `-` for delivery; symbols are already in CANONICAL space
 * (`BAJAJ-AUTO`, no `-EQ` suffix), so they join our universe via
 * `canonicalSymbol` without further work.
 *
 * POINT-IN-TIME: the bhavcopy for date D is published after D's close, i.e. it
 * is known at exactly the same moment as D's closing candle. A signal computed
 * on D's close may therefore use D's delivery data — no extra lookahead beyond
 * what the OHLCV pipeline already assumes.
 */

export type DeliveryRow = {
  /** Canonical symbol (NSE publishes these already unsuffixed). */
  symbol: string;
  /** ISO date (YYYY-MM-DD). */
  tradeDate: string;
  /** Total traded quantity. */
  tradedQty: number;
  /** Quantity that settled as delivery. */
  deliveryQty: number;
  /** Delivery as % of traded quantity, 0–100. */
  deliveryPct: number;
  /** Number of trades — a crude participation/fragmentation measure. */
  trades: number;
};

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** `17-Jul-2026` → `2026-07-17`; null when unparseable. */
export const parseBhavDate = (raw: string): string | null => {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const mm = MONTHS[m[2]!.toUpperCase()];
  return mm ? `${m[3]}-${mm}-${m[1]}` : null;
};

const num = (raw: string | undefined): number | null => {
  const t = (raw ?? '').replace(/[\s\r]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parses a full-bhavcopy CSV into EQ-series delivery rows.
 *
 * Only the `EQ` series is kept: that is the segment our universe trades, and
 * other series (GS bonds, SME, trust units) carry `-` delivery. Malformed rows
 * are skipped rather than throwing — one bad line must never cost a whole day's
 * file — and the count is returned so a caller can alarm on silent decay.
 */
export const parseBhavcopy = (csv: string): { rows: DeliveryRow[]; skipped: number } => {
  const lines = csv.split('\n');
  const rows: DeliveryRow[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const f = line.split(',');
    if (f.length < 15) {
      skipped++;
      continue;
    }
    const series = (f[1] ?? '').replace(/[\s\r]/g, '');
    if (series !== 'EQ') continue;

    const symbol = (f[0] ?? '').replace(/[\s\r]/g, '');
    const tradeDate = parseBhavDate(f[2] ?? '');
    const tradedQty = num(f[10]);
    const trades = num(f[12]);
    const deliveryQty = num(f[13]);
    const deliveryPct = num(f[14]);

    if (!symbol || !tradeDate || deliveryPct == null || tradedQty == null) {
      skipped++;
      continue;
    }
    // Delivery % is a share of traded volume; anything outside [0,100] is a
    // corrupt row, not a surprising one.
    if (deliveryPct < 0 || deliveryPct > 100) {
      skipped++;
      continue;
    }

    rows.push({
      symbol,
      tradeDate,
      tradedQty,
      deliveryQty: deliveryQty ?? 0,
      deliveryPct,
      trades: trades ?? 0,
    });
  }
  return { rows, skipped };
};

/** `2026-07-17` → `17072026`, the ddmmyyyy token the archive URL uses. */
export const bhavcopyDateToken = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-');
  return `${d}${m}${y}`;
};

export const bhavcopyUrl = (isoDate: string): string =>
  `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${bhavcopyDateToken(isoDate)}.csv`;
