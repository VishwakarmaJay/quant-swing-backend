import dayjs from 'dayjs';

import { round } from '@/factors/indicators';

import type { RawSignal } from './backtestEngine';
import type { CandleStore } from './candleStore';
import {
  DEFAULT_SIMULATOR_CONFIG,
  simulateTrade,
  type ClosedTrade,
  type SimulatorConfig,
} from './tradeSimulator';

/**
 * Portfolio-level backtest (ROADMAP B1). The signal-edge replay takes EVERY
 * signal with no caps, so its additive cumulative % is not comparable to Nifty
 * Buy & Hold. This simulator runs ONE capital base through the signal stream in
 * calendar order with the real book constraints — position limit, sector cap,
 * cash, sizing, kill switch — producing a daily mark-to-market equity curve and
 * portfolio metrics (CAGR, true max drawdown, exposure) in the SAME units as a
 * benchmark. This makes "beat Nifty" a fair, evaluable gate.
 *
 * Design: trade trajectories are independent of portfolio state (no market
 * impact is modelled), so each signal's path is precomputed with the existing
 * simulateTrade (identical fills/costs/exits as the signal-edge backtest) and
 * the portfolio pass only decides WHICH trades are taken and HOW LARGE.
 *
 * Ordering (conservative, no lookahead): entries execute at the day's open
 * BEFORE that day's exits are processed — a slot or cash freed by an intraday
 * exit is only available from the next day. Kill switch: a day that realizes a
 * loss ≥ killSwitchDailyLossPct% of that day's starting equity blocks entries
 * on the NEXT trading day (the open-time approximation of the live intraday
 * rule). Partial exits sell floor(qtyInitial × fraction) shares; the final exit
 * sells the remainder (shares are conserved, no fractional shares).
 */

export type SizingMode = 'flat' | 'conviction' | 'risk';

/**
 * Which key orders same-day candidates when slots are scarce (B11 slot-allocation
 * research). B1/B9 measured that the 2-slot book takes only ~14% of signals, so
 * *which* 14% is decided by this ordering — and Step-1 proved the incumbent key
 * (composite) has ρ≈0 with outcomes. `random` is the CONTROL: if no key beats it,
 * the bottleneck is signal quality, not allocation.
 */
export type RankKey =
  | 'composite'   // incumbent (live PortfolioManager ordering)
  | 'random'      // control — seeded, deterministic, uncorrelated with any factor
  | 'sentiment'
  | 'srs'
  | 'fundamental'
  | 'calm'        // volatility factor score desc ≈ lowest ATR% first
  | 'tight-stop'  // smallest stop distance %, i.e. most R per rupee risked
  | 'agreement';

export type PortfolioSimConfig = {
  /** Starting capital for the single book (₹). */
  initialCapital: number;
  maxOpenPositions: number;
  maxPerSector: number;
  /** flat: equity/slots · conviction: flat × composite/100 · risk: fixed % of equity at risk. */
  sizingMode: SizingMode;
  /** risk mode: % of current equity risked per trade (distance entry→SL). */
  riskPctPerTrade: number;
  /** Commission per side (%), matching the trade simulator's cost model. */
  costPctPerSide: number;
  /** Block next-day entries after a day losing ≥ this % of day-start equity (0 = off). */
  killSwitchDailyLossPct: number;
  /** Slot-allocation ordering (default 'composite' = the live/incumbent behaviour). */
  rankKey?: RankKey;
};

export const DEFAULT_PORTFOLIO_SIM_CONFIG: PortfolioSimConfig = {
  initialCapital: 200_000, // live: ₹100k base × 2 slots
  maxOpenPositions: 2,
  maxPerSector: 1,
  sizingMode: 'flat',
  riskPctPerTrade: 1,
  costPctPerSide: DEFAULT_SIMULATOR_CONFIG.costPctPerSide,
  killSwitchDailyLossPct: 5,
};

export type SkipReason = 'position-limit' | 'sector-cap' | 'sizing' | 'insufficient-cash' | 'kill-switch';

export type PortfolioTrade = {
  symbol: string;
  sector: string | null;
  entryDate: string;
  exitDate: string;
  qty: number;
  entryPrice: number;
  invested: number;
  proceeds: number;
  pnl: number;
  finalReason: ClosedTrade['finalReason'];
};

export type EquityPoint = { date: string; equity: number; cash: number; invested: number };

export type PortfolioMetrics = {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  /** Annualized from the equity curve's calendar span. */
  cagrPct: number;
  /** True peak-to-trough drawdown of the daily equity curve. */
  maxDrawdownPct: number;
  /** Mean of invested/equity across days (time in market). */
  exposureAvgPct: number;
  tradesTaken: number;
  wins: number;
  winRatePct: number;
  skipped: Record<SkipReason, number>;
  /**
   * REGRET (B11): mean net-% of trades the book actually took vs the mean net-%
   * of the candidates it had to skip for want of a slot. The ranking key adds
   * value only if taken > skipped; taken ≈ skipped means the ordering carries no
   * information (the ρ≈0 result, seen from the allocation side).
   */
  takenNetPctAvg: number;
  skippedNetPctAvg: number;
  /** takenNetPctAvg − skippedNetPctAvg. > 0 ⇒ the key picked better than it dropped. */
  selectionEdgePct: number;
  slotSkippedCount: number;
};

export type PortfolioResult = {
  equityCurve: EquityPoint[];
  trades: PortfolioTrade[];
  metrics: PortfolioMetrics;
};

/**
 * Stable string → [0,1) hash (FNV-1a). Used only by the `random` rank key so the
 * control ordering is reproducible run-to-run (determinism is sacred) while
 * carrying no factor information.
 */
const hashUnit = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
};

type OpenPosition = {
  symbol: string;
  sector: string | null;
  instrumentId: string;
  qtyInitial: number;
  qtyRemaining: number;
  entryPrice: number;
  invested: number;
  proceeds: number;
  trade: ClosedTrade;
  exitCursor: number;
};

export const simulatePortfolio = (
  store: CandleStore,
  signals: RawSignal[],
  config: PortfolioSimConfig = DEFAULT_PORTFOLIO_SIM_CONFIG,
  opts: { targetRr?: [number, number]; simulatorConfig?: SimulatorConfig; fromIndex?: number } = {},
): PortfolioResult => {
  const [rr1, rr2] = opts.targetRr ?? [2, 3];
  const simConfig = opts.simulatorConfig ?? DEFAULT_SIMULATOR_CONFIG;
  const slip = simConfig.slippageBps / 10_000;
  const costMult = config.costPctPerSide / 100;

  // Precompute each signal's trade trajectory (identical math to the signal-edge pass).
  type Candidate = { signal: RawSignal; trade: ClosedTrade };
  const byEntryDate = new Map<string, Candidate[]>();
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
    if (!trade) continue;
    (byEntryDate.get(trade.entryDate) ?? byEntryDate.set(trade.entryDate, []).get(trade.entryDate)!).push({
      signal,
      trade,
    });
  }
  // Slot-allocation ordering (B11). Every key is DETERMINISTIC — including
  // `random`, which hashes (symbol, entryDate) so the shuffle is stable across
  // runs and uncorrelated with any factor. Ties always break on symbol asc, so
  // the ordering is total and reproducible. Default = composite (live PM order).
  const rankKey: RankKey = config.rankKey ?? 'composite';
  const scoreOf = (c: Candidate): number => {
    const f = c.signal.factorScores;
    switch (rankKey) {
      case 'composite':
        return c.signal.evaluation.compositeScore;
      case 'sentiment':
        return f.sentiment ?? 50;
      case 'srs':
        return f.sectorRelativeStrength ?? 50;
      case 'fundamental':
        return f.fundamental ?? 50;
      case 'calm':
        return f.volatility ?? 50;
      case 'agreement':
        return c.signal.evaluation.agreementScore;
      case 'tight-stop':
        // Smallest stop distance ranks FIRST → negate so "desc" sorting works.
        return -((c.signal.entry - c.signal.stopLoss) / c.signal.entry) * 100;
      case 'random':
        return hashUnit(`${c.signal.symbol}|${c.trade.entryDate}`);
    }
  };
  for (const list of byEntryDate.values()) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a) || a.signal.symbol.localeCompare(b.signal.symbol));
  }

  // Per-instrument close lookup for daily mark-to-market.
  const closeByDate = new Map<string, Map<string, number>>();
  const closesFor = (instrumentId: string): Map<string, number> => {
    let m = closeByDate.get(instrumentId);
    if (!m) {
      m = new Map((store.seriesById.get(instrumentId) ?? []).map((c) => [c.tradeDate, c.close]));
      closeByDate.set(instrumentId, m);
    }
    return m;
  };

  const from = opts.fromIndex ?? 0;
  const open: OpenPosition[] = [];
  const closed: PortfolioTrade[] = [];
  const skipped: Record<SkipReason, number> = {
    'position-limit': 0,
    'sector-cap': 0,
    sizing: 0,
    'insufficient-cash': 0,
    'kill-switch': 0,
  };
  const equityCurve: EquityPoint[] = [];
  /** Net-% of candidates dropped purely for want of a slot (B11 regret). */
  const slotSkippedNetPct: number[] = [];
  /** Net-% of candidates the book actually entered (same units, for comparison). */
  const takenNetPct: number[] = [];

  let cash = config.initialCapital;
  let lastEquity = config.initialCapital;
  let lastMark = new Map<string, number>(); // instrumentId → last known close (carry-forward)
  let blockEntriesToday = false; // set by the previous day's kill-switch breach

  for (let d = from; d < store.tradingDates.length; d++) {
    const date = store.tradingDates[d]!;
    const dayStartEquity = lastEquity;
    let realizedPnlToday = 0;

    // ── 1. Entries (at the open, BEFORE today's exits — freed slots/cash wait a day).
    const candidates = byEntryDate.get(date) ?? [];
    for (const { signal, trade } of candidates) {
      if (blockEntriesToday) {
        skipped['kill-switch']++;
        continue;
      }
      if (open.length >= config.maxOpenPositions) {
        skipped['position-limit']++;
        // REGRET (B11): the trajectory of this signal is already precomputed, so
        // what the book gave up is measurable at zero cost.
        slotSkippedNetPct.push(trade.netReturnPct);
        continue;
      }
      if (
        signal.sector &&
        open.filter((p) => p.sector === signal.sector).length >= config.maxPerSector
      ) {
        skipped['sector-cap']++;
        continue;
      }

      // Sizing off current equity (marked at yesterday's close — known at the open).
      const slotBudget = dayStartEquity / config.maxOpenPositions;
      let qty: number;
      if (config.sizingMode === 'risk') {
        const riskPerShare = signal.entry - signal.stopLoss;
        qty = Math.floor((dayStartEquity * config.riskPctPerTrade) / 100 / riskPerShare);
        qty = Math.min(qty, Math.floor(slotBudget / trade.entryPrice)); // budget cap
      } else {
        const budget =
          config.sizingMode === 'conviction'
            ? slotBudget * (signal.evaluation.compositeScore / 100)
            : slotBudget;
        qty = Math.floor(budget / trade.entryPrice);
      }
      if (qty < 1) {
        skipped.sizing++;
        continue;
      }
      const affordable = Math.floor(cash / (trade.entryPrice * (1 + costMult)));
      if (affordable < 1) {
        skipped['insufficient-cash']++;
        continue;
      }
      qty = Math.min(qty, affordable);

      const invested = qty * trade.entryPrice * (1 + costMult);
      takenNetPct.push(trade.netReturnPct); // B11 regret: the "taken" side
      cash = round(cash - invested, 2);
      open.push({
        symbol: signal.symbol,
        sector: signal.sector,
        instrumentId: signal.instrumentId,
        qtyInitial: qty,
        qtyRemaining: qty,
        entryPrice: trade.entryPrice,
        invested,
        proceeds: 0,
        trade,
        exitCursor: 0,
      });
    }
    blockEntriesToday = false;

    // ── 2. Exits due today (precomputed trajectory events).
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i]!;
      while (p.exitCursor < p.trade.exits.length && p.trade.exits[p.exitCursor]!.date === date) {
        const e = p.trade.exits[p.exitCursor]!;
        const isFinal = p.exitCursor === p.trade.exits.length - 1;
        const sellQty = isFinal ? p.qtyRemaining : Math.min(p.qtyRemaining, Math.floor(p.qtyInitial * e.fraction));
        if (sellQty > 0) {
          const fill = e.price * (1 - slip);
          const proceeds = sellQty * fill * (1 - costMult);
          cash = round(cash + proceeds, 2);
          p.proceeds += proceeds;
          p.qtyRemaining -= sellQty;
          realizedPnlToday += proceeds - sellQty * p.entryPrice * (1 + costMult);
        }
        p.exitCursor++;
      }
      if (p.exitCursor >= p.trade.exits.length || p.qtyRemaining === 0) {
        closed.push({
          symbol: p.symbol,
          sector: p.sector,
          entryDate: p.trade.entryDate,
          exitDate: p.trade.exitDate,
          qty: p.qtyInitial,
          entryPrice: p.entryPrice,
          invested: round(p.invested, 2),
          proceeds: round(p.proceeds, 2),
          pnl: round(p.proceeds - p.invested, 2),
          finalReason: p.trade.finalReason,
        });
        open.splice(i, 1);
      }
    }

    // ── 3. Mark to market at the close.
    let invested = 0;
    for (const p of open) {
      const close = closesFor(p.instrumentId).get(date);
      if (close !== undefined) lastMark.set(p.instrumentId, close);
      invested += p.qtyRemaining * (close ?? lastMark.get(p.instrumentId) ?? p.entryPrice);
    }
    const equity = round(cash + invested, 2);
    equityCurve.push({ date, equity, cash: round(cash, 2), invested: round(invested, 2) });
    lastEquity = equity;

    // ── 4. Kill switch: today's realized loss blocks tomorrow's entries.
    if (
      config.killSwitchDailyLossPct > 0 &&
      realizedPnlToday < 0 &&
      Math.abs(realizedPnlToday) >= (config.killSwitchDailyLossPct / 100) * dayStartEquity
    ) {
      blockEntriesToday = true;
    }

    // Stop once past the signal window with a flat book (nothing left to mark).
    if (open.length === 0 && d >= store.tradingDates.length - 1) break;
  }

  // ── Metrics from the daily curve.
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1]!.equity : config.initialCapital;
  const totalReturnPct = round(((finalEquity - config.initialCapital) / config.initialCapital) * 100, 2);

  const first = equityCurve[0]?.date;
  const last = equityCurve[equityCurve.length - 1]?.date;
  const spanDays = first && last ? dayjs(last).diff(dayjs(first), 'day') : 0;
  const cagrPct =
    spanDays > 0 && finalEquity > 0
      ? round(((finalEquity / config.initialCapital) ** (365.25 / spanDays) - 1) * 100, 2)
      : 0;

  let peak = -Infinity;
  let maxDd = 0;
  let exposureSum = 0;
  for (const pt of equityCurve) {
    peak = Math.max(peak, pt.equity);
    maxDd = Math.min(maxDd, (pt.equity / peak - 1) * 100);
    exposureSum += pt.equity > 0 ? pt.invested / pt.equity : 0;
  }

  const wins = closed.filter((t) => t.pnl > 0).length;
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const takenAvg = mean(takenNetPct);
  const skippedAvg = mean(slotSkippedNetPct);

  return {
    equityCurve,
    trades: closed,
    metrics: {
      initialCapital: config.initialCapital,
      finalEquity,
      totalReturnPct,
      cagrPct,
      maxDrawdownPct: round(maxDd, 2),
      exposureAvgPct: equityCurve.length ? round((exposureSum / equityCurve.length) * 100, 1) : 0,
      tradesTaken: closed.length,
      wins,
      winRatePct: closed.length ? round((wins / closed.length) * 100, 1) : 0,
      skipped,
      takenNetPctAvg: round(takenAvg, 3),
      skippedNetPctAvg: round(skippedAvg, 3),
      selectionEdgePct: round(takenAvg - skippedAvg, 3),
      slotSkippedCount: slotSkippedNetPct.length,
    },
  };
};
