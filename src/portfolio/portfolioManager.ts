import { round } from '@/factors/indicators';

import {
  DEFAULT_PORTFOLIO_CONFIG,
  EMPTY_PORTFOLIO_STATE,
  type ApprovedSignal,
  type PortfolioCandidate,
  type PortfolioConfig,
  type PortfolioDecision,
  type PortfolioRejection,
  type PortfolioState,
  type PositionSizing,
} from './types';

/**
 * Conviction-based sizing: capital allocated ∝ the strategy's composite score
 * (no per-trade capital cap), then the volatility size-reduction. qty = floor
 * of allocated capital ÷ entry.
 */
const sizePosition = (candidate: PortfolioCandidate, config: PortfolioConfig): PositionSizing => {
  const { levels, compositeScore } = candidate;
  const allocatedCapital = round(config.baseCapitalPerTrade * (compositeScore / 100), 2);

  let qty = Math.floor(allocatedCapital / levels.entry);

  const { fromAtrPct, toAtrPct, multiplier } = config.sizeReduction;
  const sizeReduced = levels.atrPct >= fromAtrPct && levels.atrPct < toAtrPct;
  if (sizeReduced) qty = Math.floor(qty * multiplier);

  return {
    qty,
    positionValue: round(qty * levels.entry, 2),
    allocatedCapital,
    riskAmount: round(qty * levels.riskPerShare, 2),
    sizeReduced,
  };
};

const toApproved = (c: PortfolioCandidate, sizing: PositionSizing): ApprovedSignal => ({
  symbol: c.symbol,
  sector: c.sector,
  regime: c.regime,
  compositeScore: c.compositeScore,
  agreementScore: c.agreementScore,
  entry: c.levels.entry,
  entryLow: c.levels.entryLow,
  entryHigh: c.levels.entryHigh,
  stopLoss: c.levels.stopLoss,
  target1: c.levels.target1,
  target2: c.levels.target2,
  riskPerShare: c.levels.riskPerShare,
  rrToResistance: c.levels.rrToResistance,
  atrPct: c.levels.atrPct,
  qty: sizing.qty,
  positionValue: sizing.positionValue,
  allocatedCapital: sizing.allocatedCapital,
  riskAmount: sizing.riskAmount,
  sizeReduced: sizing.sizeReduced,
});

/**
 * PortfolioManager: given gated candidates and the current book, decide which
 * to approve. Kill switch first (blocks everything), then per-candidate
 * viability (sizing, cost), then allocation in rank order (position limit +
 * sector cap). Every non-approval carries a reason.
 */
export class PortfolioManager {
  constructor(private readonly config: PortfolioConfig = DEFAULT_PORTFOLIO_CONFIG) {}

  manage(
    candidates: PortfolioCandidate[],
    state: PortfolioState = EMPTY_PORTFOLIO_STATE,
  ): PortfolioDecision {
    const cfg = this.config;
    const rejected: PortfolioRejection[] = [];

    // Kill switch: a bad day stops all new risk.
    if (state.dailyRealizedLoss >= cfg.dailyKillSwitch) {
      return {
        approved: [],
        rejected: candidates.map((c) => ({
          symbol: c.symbol,
          reason: 'kill-switch',
          detail: `daily loss ₹${state.dailyRealizedLoss} ≥ ₹${cfg.dailyKillSwitch}`,
        })),
      };
    }

    const ranked = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);

    let slots = cfg.maxOpenPositions - state.openPositions.length;
    const sectorCount = new Map<string, number>();
    for (const p of state.openPositions) {
      if (p.sector) sectorCount.set(p.sector, (sectorCount.get(p.sector) ?? 0) + 1);
    }

    const approved: ApprovedSignal[] = [];
    for (const c of ranked) {
      const sizing = sizePosition(c, cfg);
      if (sizing.qty < 1) {
        rejected.push({
          symbol: c.symbol,
          reason: 'sizing',
          detail: `qty 0 — entry ₹${c.levels.entry} exceeds allocated ₹${sizing.allocatedCapital}`,
        });
        continue;
      }

      // Expected return to T1 must clear the transaction-cost drag.
      const expectedProfit = sizing.qty * (c.levels.target1 - c.levels.entry);
      const cost = (sizing.positionValue * cfg.roundTripCostPct) / 100;
      if (expectedProfit < cfg.minReturnVsCost * cost) {
        rejected.push({
          symbol: c.symbol,
          reason: 'cost-drag',
          detail: `expected ₹${round(expectedProfit, 2)} < ${cfg.minReturnVsCost}× cost ₹${round(cost, 2)}`,
        });
        continue;
      }

      if (slots <= 0) {
        rejected.push({
          symbol: c.symbol,
          reason: 'position-limit',
          detail: `max ${cfg.maxOpenPositions} open positions reached`,
        });
        continue;
      }

      const held = c.sector ? (sectorCount.get(c.sector) ?? 0) : 0;
      if (c.sector && held >= cfg.maxPerSector) {
        rejected.push({
          symbol: c.symbol,
          reason: 'sector-cap',
          detail: `${c.sector} already at cap ${cfg.maxPerSector}`,
        });
        continue;
      }

      approved.push(toApproved(c, sizing));
      slots--;
      if (c.sector) sectorCount.set(c.sector, held + 1);
    }

    return { approved, rejected };
  }
}
