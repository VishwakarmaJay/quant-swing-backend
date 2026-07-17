import dayjs from 'dayjs';

import { buildFeatureBundle, emaLatest, factors, round, type StockContext } from '@/factors';
import { assessDataQuality, type Candle } from '@/ohlcv';
import { detectRegime } from '@/regime';
import { computeSignalLevels } from '@/signal';
import { WeightedStrategy } from '@/strategy';

import type { CandleStore } from './candleStore';
import { DEFAULT_SIMULATOR_CONFIG, simulateTrade, type ClosedTrade, type SimulatorConfig } from './tradeSimulator';

/**
 * Backtest replay (docs BacktestEngine). Signal generation is separated from
 * exit simulation so a parameter sweep can generate signals ONCE (the expensive
 * pipeline replay) and cheaply re-simulate them under many target/time-stop
 * configs.
 *
 * As-of-date, no lookahead (candles ≤ asOf only). Measures *signal edge*: every
 * signal is taken, deduped by a fixed re-signal cooldown per stock (config-
 * independent, so the signal set is stable across a sweep). It does NOT enforce
 * the live 2-position/sizing caps. Technicals-only (no historical sentiment).
 * Survivorship bias applies (today's constituents).
 */
export type RawSignal = {
  symbol: string;
  sector: string | null;
  instrumentId: string;
  /** Signal-day index within the instrument's full candle series. */
  signalIndex: number;
  entry: number;
  stopLoss: number;
};

export type BacktestOptions = {
  warmupIndex?: number;
  fromIndex?: number;
  toIndex?: number;
};

const DEFAULT_WARMUP = 205;
/** Min gap between successive signals on the same stock (config-independent). */
const RESIGNAL_COOLDOWN_DAYS = 5;

/** The expensive pass: replay the pipeline and collect raw signals (entry + SL). */
export const generateRawSignals = (store: CandleStore, opts: BacktestOptions = {}): RawSignal[] => {
  const strategy = new WeightedStrategy();
  const from = Math.max(opts.warmupIndex ?? DEFAULT_WARMUP, opts.fromIndex ?? 0);
  const to = Math.min(opts.toIndex ?? store.tradingDates.length, store.tradingDates.length);

  const signals: RawSignal[] = [];
  const lastSignalDate = new Map<string, string>();

  for (let d = from; d < to; d++) {
    const asOf = store.tradingDates[d]!;
    const niftySlice = store.benchmark.filter((c) => c.tradeDate <= asOf);

    const slices = new Map<string, Candle[]>();
    let counted = 0;
    let above = 0;
    for (const inst of store.instruments) {
      const slice = (store.seriesById.get(inst.id) ?? []).filter((c) => c.tradeDate <= asOf);
      if (!slice.length || slice[slice.length - 1]!.tradeDate !== asOf) continue;
      slices.set(inst.id, slice);
      const ema50 = emaLatest(slice.map((c) => c.close), 50);
      if (ema50 !== null) {
        counted++;
        if (slice[slice.length - 1]!.close > ema50) above++;
      }
    }
    const breadthPct = counted ? (above / counted) * 100 : 0;
    const regime = detectRegime({ asOf, niftyCandles: niftySlice, breadthPct, vix: null });

    for (const inst of store.instruments) {
      const slice = slices.get(inst.id);
      if (!slice) continue;
      const symbol = inst.symbol.replace(/-EQ$/, '');

      const last = lastSignalDate.get(symbol);
      if (last && dayjs(asOf).diff(dayjs(last), 'day') < RESIGNAL_COOLDOWN_DAYS) continue;

      const dq = assessDataQuality(slice, asOf).score;
      if (dq < 0.8) continue;

      const ctx: StockContext = {
        symbol,
        asOf,
        candles: slice,
        dataQualityScore: dq,
        sector: inst.sector,
        benchmark: niftySlice.length ? { symbol: 'NIFTY', candles: niftySlice } : null,
      };

      if (!strategy.evaluate(buildFeatureBundle(ctx, factors), regime.regime).passed) continue;

      const math = computeSignalLevels(slice);
      if (!math.ok) continue;

      signals.push({
        symbol,
        sector: inst.sector,
        instrumentId: inst.id,
        signalIndex: slice.length - 1,
        entry: math.entry,
        stopLoss: math.stopLoss,
      });
      lastSignalDate.set(symbol, asOf);
    }
  }

  return signals;
};

/** The cheap pass: simulate raw signals under a target/time-stop config. */
export const simulateSignals = (
  store: CandleStore,
  signals: RawSignal[],
  opts: { targetRr?: [number, number]; simulatorConfig?: SimulatorConfig } = {},
): ClosedTrade[] => {
  const [rr1, rr2] = opts.targetRr ?? [2, 3];
  const simConfig = opts.simulatorConfig ?? DEFAULT_SIMULATOR_CONFIG;
  const trades: ClosedTrade[] = [];

  for (const s of signals) {
    const risk = s.entry - s.stopLoss;
    if (risk <= 0) continue;
    const series = store.seriesById.get(s.instrumentId);
    if (!series) continue;
    const trade = simulateTrade(
      series,
      s.signalIndex,
      { stopLoss: s.stopLoss, target1: round(s.entry + rr1 * risk, 2), target2: round(s.entry + rr2 * risk, 2) },
      { symbol: s.symbol, sector: s.sector },
      simConfig,
    );
    if (trade) trades.push(trade);
  }
  return trades;
};

export type BacktestRun = {
  trades: ClosedTrade[];
  signalCount: number;
  window: { from: string; to: string };
  daysReplayed: number;
};

export const runBacktest = (
  store: CandleStore,
  opts: BacktestOptions & { targetRr?: [number, number]; simulatorConfig?: SimulatorConfig } = {},
): BacktestRun => {
  const from = Math.max(opts.warmupIndex ?? DEFAULT_WARMUP, opts.fromIndex ?? 0);
  const to = Math.min(opts.toIndex ?? store.tradingDates.length, store.tradingDates.length);
  const signals = generateRawSignals(store, opts);
  const trades = simulateSignals(store, signals, opts);
  return {
    trades,
    signalCount: signals.length,
    window: { from: store.tradingDates[from] ?? '', to: store.tradingDates[to - 1] ?? '' },
    daysReplayed: to - from,
  };
};
