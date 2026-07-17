import { round } from '@/factors/indicators';

import type { ClosedTrade } from './tradeSimulator';

/**
 * Performance metrics from a set of closed trades. Returns are per-trade net %
 * (position-level, sizing-agnostic), so the numbers measure the *signal edge*
 * independent of the capital model. Sharpe/Sortino are trade-level (mean ÷
 * dispersion), not annualized — labelled as such.
 */
export type BacktestMetrics = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  /** Average net return per trade (expectancy). */
  expectancyPct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Σ gross wins ÷ |Σ gross losses|. */
  profitFactor: number;
  /** Additive cumulative return across trades (equal-weight). */
  cumulativeReturnPct: number;
  maxDrawdownPct: number;
  sharpeTradeLevel: number;
  sortinoTradeLevel: number;
  bestPct: number;
  worstPct: number;
  avgHoldingDays: number;
  /** Count of trades by their final exit reason. */
  exitReasons: Record<string, number>;
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** Max drawdown (%) of the additive cumulative-return equity curve. */
const maxDrawdown = (returns: number[]): number => {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return maxDd; // ≤ 0
};

export const computeMetrics = (trades: ClosedTrade[]): BacktestMetrics => {
  const returns = trades.map((t) => t.netReturnPct);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);

  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const downside = returns.filter((r) => r < 0);
  const sd = stddev(returns);
  const dd = stddev(downside);

  const exitReasons: Record<string, number> = {};
  for (const t of trades) exitReasons[t.finalReason] = (exitReasons[t.finalReason] ?? 0) + 1;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    expectancyPct: round(mean(returns), 3),
    avgWinPct: round(mean(wins), 3),
    avgLossPct: round(mean(losses), 3),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? Infinity : 0,
    cumulativeReturnPct: round(returns.reduce((a, b) => a + b, 0), 2),
    maxDrawdownPct: round(maxDrawdown(returns), 2),
    sharpeTradeLevel: sd > 0 ? round(mean(returns) / sd, 2) : 0,
    sortinoTradeLevel: dd > 0 ? round(mean(returns) / dd, 2) : 0,
    bestPct: returns.length ? round(Math.max(...returns), 2) : 0,
    worstPct: returns.length ? round(Math.min(...returns), 2) : 0,
    avgHoldingDays: trades.length ? round(mean(trades.map((t) => t.holdingDays)), 1) : 0,
    exitReasons,
  };
};
