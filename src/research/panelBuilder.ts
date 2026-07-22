import {
  buildFeatureBundle,
  DEFAULT_SECTOR_RS_CONFIG,
  emaLatest,
  factors,
  lookbackReturnPct,
  type StockContext,
} from '@/factors';
import { fundamentalsAsOf, type FundamentalSnapshotAsOf } from '@/fundamentals';
import { DEFAULT_SENTIMENT_AGGREGATE_CONFIG, sentimentInputsAsOf } from '@/news/sentimentAggregate';
import { assessDataQuality, type Candle } from '@/ohlcv';
import { detectRegime } from '@/regime';
import { WeightedStrategy } from '@/strategy';
import { isMemberOn } from '@/universe/membership';
import { canonicalSymbol } from '@/universe/symbols';

import type { CandleStore } from '@/backtest';
import type { ForwardLabel, Horizon } from './forwardLabels';

/**
 * Ungated cross-sectional factor panel (research layer, Task 4/5).
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): a factor panel needs
 * EVERY universe member on EVERY date, whereas the production replay
 * (`backtestEngine.generateRawSignals`) emits only GATE-PASSING signals and also
 * applies a DQ≥0.8 screen and a 5-day resignal cooldown — so it cannot be reused
 * to build a full panel. This module MIRRORS that engine's per-date
 * cross-sectional pre-pass but reuses every LEAF helper it uses
 * (`buildFeatureBundle`, `factors`, `emaLatest`, `lookbackReturnPct`,
 * `fundamentalsAsOf`, `sentimentInputsAsOf`, `assessDataQuality`, `detectRegime`,
 * `isMemberOn`, `canonicalSymbol`) and the production composite
 * (`WeightedStrategy`, read-only) — no factor, ranking, candle, or PIT logic is
 * re-implemented. Only the *orchestration* is duplicated, so the production
 * replay path stays byte-identical (baseline untouched, per constraints #1/#2).
 *
 * DIFFERENCES from the production loop, by design:
 *  - NO gate filter — every member is scored (we measure information, not the
 *    strategy's selection of it).
 *  - NO resignal cooldown — every date is an independent cross-section.
 *  - DQ is NOT a filter — it is recorded as a COLUMN (`dq`) so it can be a
 *    split, not a silent survivorship exclusion (audit H-3).
 *
 * DAY CONVENTION — scores are as-of the CLOSE of `date` (candles ≤ date only, no
 * lookahead). Labels are joined at the next-bar-entry TRADING-day horizons of
 * `forwardLabels.ts`. SIZE PROXY — `logAdv = log(rolling-median(close×volume))`
 * over the trailing `advWindow` bars; a documented approximation of market-cap
 * weight (no shares-outstanding data exists in the candle store).
 */

/** Subjects measured: the 8 registered factors plus the production composite. */
export const COMPOSITE_KEY = 'composite';

export type PanelRow = {
  date: string;
  symbol: string;
  instrumentId: string;
  sector: string | null;
  regime: string;
  /** 0–100 score per factor name, plus `composite` (the regime-weighted blend). */
  scores: Record<string, number>;
  /** DataQuality score at `date` — a SPLIT column, never a filter (audit H-3). */
  dq: number;
  /** Size proxy: log(rolling-median close×volume). null when volume is absent. */
  logAdv: number | null;
  /** Joined by `joinLabels`: raw forward returns (%), per horizon. */
  fwd?: Partial<Record<Horizon, number>>;
  /** Joined by `joinLabels`: market-excess forward returns (%), per horizon. */
  xs?: Partial<Record<Horizon, number>>;
  /** Filled by `residualize`: residualised forward returns (%), per horizon. */
  resid?: Partial<Record<Horizon, number>>;
};

export type PanelOptions = {
  /** First trading-date index scored (needs history for the factors). */
  warmupIndex?: number;
  fromIndex?: number;
  toIndex?: number;
  /** Trailing bars for the ADV size proxy. */
  advWindow?: number;
};

const DEFAULT_WARMUP = 205; // matches backtestEngine's DEFAULT_WARMUP
const DEFAULT_ADV_WINDOW = 20;
const SENTIMENT_WINDOW_DAYS = DEFAULT_SENTIMENT_AGGREGATE_CONFIG.windowDays;

/** Median of a numeric array (sorted copy); NaN for empty input. */
const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** log(rolling-median close×volume) over the trailing `window` bars, or null. */
const logAdvOf = (slice: readonly Candle[], window: number): number | null => {
  const tail = slice.slice(-window);
  const turnovers = tail.map((c) => c.close * c.volume).filter((t) => t > 0);
  if (turnovers.length === 0) return null;
  const med = median(turnovers);
  return med > 0 ? Math.log(med) : null;
};

/**
 * Builds the ungated factor panel over `[warmup, to)`. Pure over the injected
 * store; deterministic (no wall-clock, no randomness). Heavy: scores every
 * member every date. `WeightedStrategy` is read-only here — used solely to read
 * the production `compositeScore`; no config or scoring logic is touched.
 */
export const buildFactorPanel = (store: CandleStore, opts: PanelOptions = {}): PanelRow[] => {
  const strategy = new WeightedStrategy();
  const advWindow = opts.advWindow ?? DEFAULT_ADV_WINDOW;
  const from = Math.max(opts.warmupIndex ?? DEFAULT_WARMUP, opts.fromIndex ?? 0);
  const to = Math.min(opts.toIndex ?? store.tradingDates.length, store.tradingDates.length);

  const rows: PanelRow[] = [];

  for (let d = from; d < to; d++) {
    const asOf = store.tradingDates[d]!;
    const asOfMidnightMs = new Date(`${asOf}T00:00:00.000Z`).getTime();
    const niftySlice = store.benchmark.filter((c) => c.tradeDate <= asOf);

    // ── Cross-sectional pre-pass (mirrors backtestEngine 89–129) ──
    const slices = new Map<string, Candle[]>();
    const sectorReturns = new Map<string, number[]>();
    const fundamentalsById = new Map<string, FundamentalSnapshotAsOf>();
    const sectorPes = new Map<string, number[]>();
    let counted = 0;
    let above = 0;
    for (const inst of store.instruments) {
      const slice = (store.seriesById.get(inst.id) ?? []).filter((c) => c.tradeDate <= asOf);
      if (!slice.length || slice[slice.length - 1]!.tradeDate !== asOf) continue;
      if (!isMemberOn(canonicalSymbol(inst.symbol), asOf)) continue;
      slices.set(inst.id, slice);
      const closes = slice.map((c) => c.close);
      const ema50 = emaLatest(closes, 50);
      if (ema50 !== null) {
        counted++;
        if (slice[slice.length - 1]!.close > ema50) above++;
      }
      if (inst.sector) {
        const ret = lookbackReturnPct(closes, DEFAULT_SECTOR_RS_CONFIG.lookback);
        if (ret !== null) {
          (sectorReturns.get(inst.sector) ?? sectorReturns.set(inst.sector, []).get(inst.sector)!).push(ret);
        }
      }
      const quarters = store.fundamentalsBySymbol.get(canonicalSymbol(inst.symbol));
      if (quarters?.length) {
        const snap = fundamentalsAsOf(quarters, slice[slice.length - 1]!.close, asOf);
        fundamentalsById.set(inst.id, snap);
        if (inst.sector && snap.pe !== null) {
          (sectorPes.get(inst.sector) ?? sectorPes.set(inst.sector, []).get(inst.sector)!).push(snap.pe);
        }
      }
    }
    const breadthPct = counted ? (above / counted) * 100 : 0;
    const regime = detectRegime({
      asOf,
      niftyCandles: niftySlice,
      breadthPct,
      vix: store.vixByDate.get(asOf) ?? null,
    });

    // ── Score EVERY member (ungated) ──
    for (const inst of store.instruments) {
      const slice = slices.get(inst.id);
      if (!slice) continue;
      const symbol = canonicalSymbol(inst.symbol);
      const dq = assessDataQuality(slice, asOf).score;

      const ctx: StockContext = {
        symbol,
        asOf,
        candles: slice,
        dataQualityScore: dq,
        sector: inst.sector,
        benchmark: niftySlice.length ? { symbol: 'NIFTY', candles: niftySlice } : null,
        sectorPeers: inst.sector
          ? { peerReturnsPct: sectorReturns.get(inst.sector) ?? [], lookback: DEFAULT_SECTOR_RS_CONFIG.lookback }
          : null,
        fundamentals: (() => {
          const snap = fundamentalsById.get(inst.id);
          return snap ? { ...snap, sectorPeerPes: inst.sector ? (sectorPes.get(inst.sector) ?? []) : [] } : null;
        })(),
        sentiment: (() => {
          const articles = store.newsBySymbol.get(symbol);
          if (!articles?.length) return null;
          const inputs = sentimentInputsAsOf(articles, asOfMidnightMs, SENTIMENT_WINDOW_DAYS);
          return inputs.length ? { articles: inputs } : null;
        })(),
      };

      const bundle = buildFeatureBundle(ctx, factors);
      const evaluation = strategy.evaluate(bundle, regime.regime);

      const scores: Record<string, number> = {};
      for (const name of Object.keys(bundle.results)) scores[name] = bundle.results[name]!.score;
      scores[COMPOSITE_KEY] = evaluation.compositeScore;

      rows.push({
        date: asOf,
        symbol,
        instrumentId: inst.id,
        sector: inst.sector,
        regime: regime.regime,
        scores,
        dq,
        logAdv: logAdvOf(slice, advWindow),
      });
    }
  }

  return rows;
};

/**
 * Joins forward labels (at t+h) onto panel rows (scored at t) by `(date,
 * symbol)`. Returns the SAME rows, mutated with `fwd`/`xs`; rows without a label
 * keep undefined label maps (they carry no forward information and are skipped
 * by the IC/quantile stages). Pure join — no imputation.
 */
export const joinLabels = (panel: PanelRow[], labels: ForwardLabel[]): PanelRow[] => {
  const byKey = new Map<string, ForwardLabel>();
  for (const l of labels) byKey.set(`${l.date} ${l.symbol}`, l);
  for (const row of panel) {
    const l = byKey.get(`${row.date} ${row.symbol}`);
    if (l) {
      row.fwd = l.fwd;
      row.xs = l.xs;
    }
  }
  return panel;
};
