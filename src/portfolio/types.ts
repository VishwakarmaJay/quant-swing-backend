import type { MarketRegime } from '@/regime';
import type { SignalLevels } from '@/signal';

/**
 * PortfolioManager layer (docs ADR-0004 / TRADING_RULES). The strategy said a
 * trade is good and signal math gave it levels; this layer decides whether we
 * can take it *now* — sizing (₹50 risk, ₹3,000 cap, volatility size-reduction),
 * the 2-position limit, 1-per-sector cap, and the daily kill switch — emitting
 * ApprovedSignal | PortfolioRejection with an auditable reason.
 */

/** A gated candidate handed to the PortfolioManager (passed strategy + signal math). */
export type PortfolioCandidate = {
  symbol: string;
  sector: string | null;
  regime: MarketRegime;
  compositeScore: number;
  agreementScore: number;
  levels: SignalLevels;
};

export type PositionSizing = {
  qty: number;
  positionValue: number;
  /** Capital allocated to this trade (conviction-scaled). */
  allocatedCapital: number;
  /** qty × riskPerShare (₹ at risk if stopped). */
  riskAmount: number;
  /** True when the volatility size-reduction multiplier was applied. */
  sizeReduced: boolean;
};

export type ApprovedSignal = {
  symbol: string;
  sector: string | null;
  regime: MarketRegime;
  compositeScore: number;
  agreementScore: number;
  entry: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskPerShare: number;
  rrToResistance: number | null;
  atrPct: number;
  qty: number;
  positionValue: number;
  allocatedCapital: number;
  riskAmount: number;
  sizeReduced: boolean;
};

export type PortfolioRejection = { symbol: string; reason: string; detail: string };

export type PortfolioDecision = {
  approved: ApprovedSignal[];
  rejected: PortfolioRejection[];
};

/** Current book state the manager reconciles against. */
export type PortfolioState = {
  /** Sectors of currently open positions (fills slots + sector caps). */
  openPositions: { sector: string | null }[];
  /** Realized loss so far today (positive ₹); trips the kill switch. */
  dailyRealizedLoss: number;
};

export const EMPTY_PORTFOLIO_STATE: PortfolioState = { openPositions: [], dailyRealizedLoss: 0 };

/**
 * How per-trade capital is decided.
 *
 * - `conviction` (legacy): allocated ∝ compositeScore. **Measured inferior.**
 *   B1/B9/B11 all favour risk sizing, and B11 explains the mechanism: the
 *   composite ranks trades no better than a coin flip (selEdge ≤ random), so
 *   scaling capital by it sizes up on noise.
 * - `risk` (default since 2026-07-20): a fixed % of the book is put at risk per
 *   trade — qty from the entry→stop distance, capped by the slot budget. Best
 *   returns AND roughly half the drawdown in every simulated cell
 *   ([`SLOT_ALLOCATION.md`](../../docs/SLOT_ALLOCATION.md) §4).
 */
export type PortfolioSizingMode = 'conviction' | 'risk';

export type PortfolioConfig = {
  /** Per-trade slot budget (the book is this × maxOpenPositions). Under
   *  `conviction` it is scaled by compositeScore÷100; under `risk` it caps the
   *  risk-derived quantity. */
  baseCapitalPerTrade: number;
  /** Sizing model (default `risk` — see PortfolioSizingMode). */
  sizingMode: PortfolioSizingMode;
  /** `risk` mode: % of the whole book risked per trade (entry→stop distance). */
  riskPctPerTrade: number;
  /** Realized daily loss (₹) that trips the kill switch. */
  dailyKillSwitch: number;
  maxOpenPositions: number;
  maxPerSector: number;
  /** Expected return to T1 must exceed this × round-trip cost. */
  minReturnVsCost: number;
  /** Round-trip transaction cost as % of position value. */
  roundTripCostPct: number;
  sizeReduction: { fromAtrPct: number; toAtrPct: number; multiplier: number };
};

export const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = {
  baseCapitalPerTrade: 100_000, // placeholder — set to your intended per-trade budget
  // Operator decision 2026-07-20 (B9 + B11 evidence): risk sizing replaced
  // conviction sizing. 1% of the book matches what the portfolio simulator
  // evaluated, so live sizing and the backtested sizing are the same model.
  sizingMode: 'risk',
  riskPctPerTrade: 1,
  dailyKillSwitch: 5_000, // revisit alongside the (now uncapped) capital model
  maxOpenPositions: 2,
  maxPerSector: 1,
  minReturnVsCost: 3.0,
  roundTripCostPct: 0.25,
  sizeReduction: { fromAtrPct: 3.0, toAtrPct: 6.0, multiplier: 0.75 },
};
