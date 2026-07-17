import dayjs from 'dayjs';

import {
  buildFeatureBundle,
  DEFAULT_SECTOR_RS_CONFIG,
  emaLatest,
  factors,
  lookbackReturnPct,
  round,
  type StockContext,
} from '@/factors';
import { assessDataQuality, type Candle } from '@/ohlcv';
import { detectRegime } from '@/regime';
import { computeSignalLevels } from '@/signal';
import { WeightedStrategy, type Strategy, type StrategyEvaluation } from '@/strategy';

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
  /**
   * The full strategy evaluation at signal time (factor scores, composite,
   * agreement, regime, gate results). Always populated; used by the attribution
   * tooling to correlate the decision context with the realised outcome. The
   * sweep ignores it, so the stable signal-set guarantee is unaffected.
   */
  evaluation: StrategyEvaluation;
  /** Each factor's 0–100 score at signal time (trend, momentum, …, volatility). */
  factorScores: Record<string, number>;
};

export type BacktestOptions = {
  warmupIndex?: number;
  fromIndex?: number;
  toIndex?: number;
  /**
   * Strategy to evaluate candidates with. Defaults to the production
   * WeightedStrategy. Attribution injects variants (a gate disabled, or a
   * factor dropped from the composite) to measure marginal edge.
   */
  strategy?: Strategy;
};

const DEFAULT_WARMUP = 205;
/** Min gap between successive signals on the same stock (config-independent). */
const RESIGNAL_COOLDOWN_DAYS = 5;

/** The expensive pass: replay the pipeline and collect raw signals (entry + SL). */
export const generateRawSignals = (store: CandleStore, opts: BacktestOptions = {}): RawSignal[] => {
  const strategy = opts.strategy ?? new WeightedStrategy();
  const from = Math.max(opts.warmupIndex ?? DEFAULT_WARMUP, opts.fromIndex ?? 0);
  const to = Math.min(opts.toIndex ?? store.tradingDates.length, store.tradingDates.length);

  const signals: RawSignal[] = [];
  const lastSignalDate = new Map<string, string>();

  for (let d = from; d < to; d++) {
    const asOf = store.tradingDates[d]!;
    const niftySlice = store.benchmark.filter((c) => c.tradeDate <= asOf);

    const slices = new Map<string, Candle[]>();
    const sectorReturns = new Map<string, number[]>();
    let counted = 0;
    let above = 0;
    for (const inst of store.instruments) {
      const slice = (store.seriesById.get(inst.id) ?? []).filter((c) => c.tradeDate <= asOf);
      if (!slice.length || slice[slice.length - 1]!.tradeDate !== asOf) continue;
      slices.set(inst.id, slice);
      const closes = slice.map((c) => c.close);
      const ema50 = emaLatest(closes, 50);
      if (ema50 !== null) {
        counted++;
        if (slice[slice.length - 1]!.close > ema50) above++;
      }
      // Cross-sectional pre-pass: this stock's lookback return into its sector bucket.
      if (inst.sector) {
        const ret = lookbackReturnPct(closes, DEFAULT_SECTOR_RS_CONFIG.lookback);
        if (ret !== null) {
          (sectorReturns.get(inst.sector) ?? sectorReturns.set(inst.sector, []).get(inst.sector)!).push(ret);
        }
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
        sectorPeers: inst.sector
          ? { peerReturnsPct: sectorReturns.get(inst.sector) ?? [], lookback: DEFAULT_SECTOR_RS_CONFIG.lookback }
          : null,
      };

      const bundle = buildFeatureBundle(ctx, factors);
      const evaluation = strategy.evaluate(bundle, regime.regime);
      if (!evaluation.passed) continue;

      const math = computeSignalLevels(slice);
      if (!math.ok) continue;

      const factorScores: Record<string, number> = {};
      for (const name of Object.keys(bundle.results)) factorScores[name] = bundle.results[name]!.score;

      signals.push({
        symbol,
        sector: inst.sector,
        instrumentId: inst.id,
        signalIndex: slice.length - 1,
        entry: math.entry,
        stopLoss: math.stopLoss,
        evaluation,
        factorScores,
      });
      lastSignalDate.set(symbol, asOf);
    }
  }

  return signals;
};

/** A raw signal paired with the trade it produced (for attribution). */
export type SignalTrade = { signal: RawSignal; trade: ClosedTrade };

/**
 * The cheap pass, keeping the signal→trade pairing. Attribution needs each
 * trade's originating decision context (factor scores, composite, regime).
 */
export const simulateSignalsPaired = (
  store: CandleStore,
  signals: RawSignal[],
  opts: { targetRr?: [number, number]; simulatorConfig?: SimulatorConfig } = {},
): SignalTrade[] => {
  const [rr1, rr2] = opts.targetRr ?? [2, 3];
  const simConfig = opts.simulatorConfig ?? DEFAULT_SIMULATOR_CONFIG;
  const pairs: SignalTrade[] = [];

  for (const signal of signals) {
    const risk = signal.entry - signal.stopLoss;
    if (risk <= 0) continue;
    const series = store.seriesById.get(signal.instrumentId);
    if (!series) continue;
    const trade = simulateTrade(
      series,
      signal.signalIndex,
      {
        stopLoss: signal.stopLoss,
        target1: round(signal.entry + rr1 * risk, 2),
        target2: round(signal.entry + rr2 * risk, 2),
      },
      { symbol: signal.symbol, sector: signal.sector },
      simConfig,
    );
    if (trade) pairs.push({ signal, trade });
  }
  return pairs;
};

/** The cheap pass: simulate raw signals under a target/time-stop config. */
export const simulateSignals = (
  store: CandleStore,
  signals: RawSignal[],
  opts: { targetRr?: [number, number]; simulatorConfig?: SimulatorConfig } = {},
): ClosedTrade[] => simulateSignalsPaired(store, signals, opts).map((p) => p.trade);

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
