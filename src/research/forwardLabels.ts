import type { CandleStore } from '@/backtest';
import { canonicalSymbol } from '@/universe/symbols';

/**
 * Forward-return label store (research layer, Task 4/5).
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): the alignment logic
 * is LIFTED and GENERALISED from `src/scripts/runDeliveryStudy.ts`'s inline
 * `forwardExcess` (lines 104–119), which is (a) a private closure over the
 * script's maps and (b) excess-only. This module keeps that function's exact,
 * verified alignment — trading-day, next-bar entry — but returns BOTH the raw
 * forward return (`fwd`) and the market-excess return (`xs`), for every horizon,
 * as a reusable pure function. Nothing here re-implements ranking, candle
 * loading, or benchmark loading — those are imported/injected.
 *
 * DAY CONVENTION — TRADING days, never calendar. For a score known at the close
 * of date `t` (index `i` in the stock's own trading-date series), entry is the
 * NEXT bar `dates[i+1]` (you see the close at `t`, you act at `t+1`, matching the
 * trade simulator's next-open discipline) and the horizon-`h` exit is
 * `dates[i+1+h]`. So `fwd5` is 5 trading bars after entry. This DIFFERS from the
 * simulator's calendar-day `timeStopDays` (a 7-calendar-day exit ≈ `fwd5`).
 *
 * NO IMPUTATION — a label is `null`/absent whenever the required forward candle
 * (or benchmark candle, for `xs`) does not exist. Missing data is never filled.
 *
 * CAVEAT — `xs` subtracts the NSE **Price** index ('NSE:Nifty 50'); it is
 * dividend-understated (~1.2–1.5%/yr). `fwd` is unaffected.
 */

export const HORIZONS = [1, 3, 5, 10, 21, 63] as const;
export type Horizon = (typeof HORIZONS)[number];

export type ForwardLabel = {
  date: string;
  symbol: string;
  /** Raw close-to-close forward return (%), next-bar entry, per horizon. */
  fwd: Partial<Record<Horizon, number>>;
  /** Market-excess (stock − benchmark) over the same window (%), per horizon. */
  xs: Partial<Record<Horizon, number>>;
};

/**
 * Forward return of one `(symbol, date, h)` from the stock's own trading-date
 * series. `fwd` needs only the stock's closes; `xs` additionally needs the
 * benchmark at both endpoints (else `xs` is null while `fwd` may still be set).
 * Generalises `runDeliveryStudy.forwardExcess` (excess-only) — same alignment.
 */
export const forwardReturn = (
  dates: readonly string[],
  closes: ReadonlyMap<string, number>,
  benchByDate: ReadonlyMap<string, number> | null,
  date: string,
  h: number,
): { fwd: number | null; xs: number | null } => {
  const i = dates.indexOf(date);
  // Signal known at date's close → entry at the next bar (i+1), exit at i+1+h.
  if (i < 0 || i + 1 + h >= dates.length) return { fwd: null, xs: null };
  const d0 = dates[i + 1]!;
  const d1 = dates[i + 1 + h]!;
  const c0 = closes.get(d0);
  const c1 = closes.get(d1);
  if (c0 == null || c1 == null || c0 <= 0) return { fwd: null, xs: null };
  const fwd = (c1 / c0 - 1) * 100;

  if (!benchByDate) return { fwd, xs: null };
  const b0 = benchByDate.get(d0);
  const b1 = benchByDate.get(d1);
  if (b0 == null || b1 == null || b0 <= 0) return { fwd, xs: null };
  const xs = fwd - (b1 / b0 - 1) * 100;
  return { fwd, xs };
};

/**
 * Every `(date, symbol)` forward label over the whole store. The store is the
 * single source of candles + benchmark (imported, not re-loaded). A label is
 * emitted for a date only if at least one horizon is computable; empty-`fwd`
 * rows are dropped (all-null carries no information and would bloat the join).
 */
export const buildForwardLabels = (store: CandleStore): ForwardLabel[] => {
  const benchByDate = new Map((store.benchmark ?? []).map((c) => [c.tradeDate, c.close]));

  const out: ForwardLabel[] = [];
  for (const inst of store.instruments) {
    const series = store.seriesById.get(inst.id) ?? [];
    if (series.length === 0) continue;
    const symbol = canonicalSymbol(inst.symbol);
    const dates = series.map((c) => c.tradeDate);
    const closes = new Map(series.map((c) => [c.tradeDate, c.close]));

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;
      const fwd: Partial<Record<Horizon, number>> = {};
      const xs: Partial<Record<Horizon, number>> = {};
      let any = false;
      for (const h of HORIZONS) {
        const r = forwardReturn(dates, closes, benchByDate, date, h);
        if (r.fwd !== null) {
          fwd[h] = r.fwd;
          any = true;
        }
        if (r.xs !== null) xs[h] = r.xs;
      }
      if (any) out.push({ date, symbol, fwd, xs });
    }
  }
  return out;
};
