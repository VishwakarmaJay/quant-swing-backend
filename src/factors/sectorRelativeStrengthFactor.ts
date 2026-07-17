import { lookbackReturnPct, round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * SectorRelativeStrengthFactor — where the stock's lookback return ranks among
 * its SECTOR peers (the deferred, cross-sectional half of relative strength;
 * the existing RelativeStrengthFactor is vs-Nifty only). This is genuinely
 * different information: not "is the stock going up" (trend/momentum) nor "does
 * it beat the market" (RS-vs-Nifty), but "does it lead or lag the stocks it
 * trades alongside" — sector leadership.
 *
 * The peer group's returns are injected via `ctx.sectorPeers` by a
 * cross-sectional pre-pass (a single stock cannot see its peers), so evaluate
 * stays pure and deterministic. The factor owns only the scoring: a tie-safe
 * percentile rank of this stock among its peers → 0–100.
 */

export type SectorRelativeStrengthFactorConfig = {
  /** Lookback in trading days for the return comparison (matches RS vs-Nifty). */
  lookback: number;
  /** Minimum peers (incl. self) needed to rank; below this the score is neutral. */
  minPeers: number;
};

export const DEFAULT_SECTOR_RS_CONFIG: SectorRelativeStrengthFactorConfig = {
  lookback: 60,
  minPeers: 3,
};

/** Neutral, no-information output (no lean either way). */
const neutral = (reason: string, extra: Record<string, number | string> = {}): FactorOutput => ({
  score: 50,
  agreementContribution: 0,
  explanations: [reason],
  metrics: { ...extra },
});

export class SectorRelativeStrengthFactor implements Factor {
  readonly name = 'sectorRelativeStrength';
  readonly category = FactorCategory.RELATIVE_STRENGTH;

  constructor(private readonly config: SectorRelativeStrengthFactorConfig = DEFAULT_SECTOR_RS_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { lookback, minPeers } = this.config;

    const peers = ctx.sectorPeers;
    if (!peers || peers.peerReturnsPct.length === 0) {
      return neutral('no sector peer data for sector-relative strength');
    }

    const selfRet = lookbackReturnPct(
      ctx.candles.map((c) => c.close),
      lookback,
    );
    if (selfRet === null) {
      return neutral(`insufficient history for sector RS (need ${lookback + 1}, have ${ctx.candles.length})`);
    }

    const peerReturns = peers.peerReturnsPct;
    if (peerReturns.length < minPeers) {
      return neutral(`only ${peerReturns.length} peer(s) in sector (need ${minPeers}) — sector RS neutral`, {
        peerCount: peerReturns.length,
        stockReturnPct: round(selfRet, 2),
      });
    }

    // Tie-safe percentile rank of this stock's return among its sector peers
    // (mid-rank convention, matching VolatilityFactor's percentile).
    const below = peerReturns.filter((r) => r < selfRet).length;
    const equal = peerReturns.filter((r) => r === selfRet).length;
    const percentile = (below + 0.5 * equal) / peerReturns.length; // 0..1
    const score = round(percentile * 100, 2);
    const norm = round((score - 50) / 50, 4); // −1..+1 directional lean

    const sorted = [...peerReturns].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const rankFromTop = peerReturns.filter((r) => r > selfRet).length + 1;

    const explanations = [
      `Ranks #${rankFromTop}/${peerReturns.length} in sector over ${lookback}d ` +
        `(${round(percentile * 100, 0)}th percentile; stock ${round(selfRet, 2)}% vs sector median ${round(median, 2)}%)`,
    ];

    return {
      score,
      agreementContribution: norm,
      explanations,
      metrics: {
        stockReturnPct: round(selfRet, 2),
        sectorMedianReturnPct: round(median, 2),
        percentile: round(percentile * 100, 1),
        rankFromTop,
        peerCount: peerReturns.length,
        lookback,
      },
    };
  }
}
