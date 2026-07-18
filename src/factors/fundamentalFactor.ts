import { round } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * FundamentalFactor (ROADMAP B5) — the first orthogonal-data factor: scores a
 * stock's fundamentals as-of the evaluation date from two components:
 *
 *  - VALUE: rank-based percentile of the stock's as-of P/E within its sector
 *    (cheaper than peers → higher). Rank-based per the B4 adjustment audit —
 *    robust to the single-name P/E outliers (demergers, exceptional items)
 *    that make absolute P/E untrustworthy; nulls (loss-makers) are excluded
 *    from the ranking rather than winsorized into it.
 *  - GROWTH: TTM EPS YoY growth mapped linearly to 0–100 (±growthCapPct = the
 *    extremes), with a loss→profit turnaround scored fully bullish.
 *
 * Components that cannot be computed (loss-making P/E, <8 known quarters) drop
 * out and their weight renormalizes — the same convention as the composite's
 * buckets. No data at all → neutral 50, agreement 0.
 *
 * All inputs arrive via `ctx.fundamentals`, injected by a cross-sectional
 * pre-pass from announcement-dated quarters (a June quarter announced 17 July
 * did not exist publicly on 1 July) — evaluate stays pure. The
 * results-pending / days-since-result values are exposed as metrics (risk
 * flags for the operator and attribution), not scored.
 */

export type FundamentalFactorConfig = {
  /** Minimum sector peers with a valid P/E (incl. self) needed to rank value. */
  minPeers: number;
  /** |TTM EPS YoY growth %| at which the growth component saturates (0 or 100). */
  growthCapPct: number;
  /** Component weights (renormalized over whichever components are present). */
  valueWeight: number;
  growthWeight: number;
};

export const DEFAULT_FUNDAMENTAL_CONFIG: FundamentalFactorConfig = {
  minPeers: 3,
  growthCapPct: 40,
  valueWeight: 0.6,
  growthWeight: 0.4,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Neutral, no-information output (no lean either way). */
const neutral = (reason: string, extra: Record<string, number | string | boolean> = {}): FactorOutput => ({
  score: 50,
  agreementContribution: 0,
  explanations: [reason],
  metrics: { ...extra },
});

export class FundamentalFactor implements Factor {
  readonly name = 'fundamental';
  readonly category = FactorCategory.FUNDAMENTAL;

  constructor(private readonly config: FundamentalFactorConfig = DEFAULT_FUNDAMENTAL_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { minPeers, growthCapPct, valueWeight, growthWeight } = this.config;
    const f = ctx.fundamentals;

    if (!f || f.quartersKnown === 0) {
      return neutral('no fundamental data as of this date — neutral');
    }

    const explanations: string[] = [];
    const metrics: Record<string, number | string | boolean> = {
      quartersKnown: f.quartersKnown,
      resultsPending: f.resultsPending,
    };
    if (f.daysSinceLastResult !== null) metrics.daysSinceLastResult = f.daysSinceLastResult;
    if (f.ttmEps !== null) metrics.ttmEps = round(f.ttmEps, 2);
    if (f.pe !== null) metrics.pe = round(f.pe, 2);

    // ── VALUE: P/E percentile within sector (cheaper = higher score) ──
    let valueScore: number | null = null;
    const peers = f.sectorPeerPes;
    if (f.pe === null) {
      explanations.push(
        f.ttmEps !== null && f.ttmEps <= 0
          ? 'loss-making (TTM EPS ≤ 0) — P/E undefined, value component dropped'
          : 'P/E unavailable — value component dropped',
      );
    } else if (peers.length < minPeers) {
      explanations.push(`only ${peers.length} sector peer(s) with valid P/E (need ${minPeers}) — value neutral`);
      metrics.pePeerCount = peers.length;
    } else {
      // Tie-safe mid-rank of own P/E among peers; CHEAPER than peers = higher.
      const above = peers.filter((p) => p > f.pe!).length;
      const equal = peers.filter((p) => p === f.pe!).length;
      const cheaperPctl = (above + 0.5 * equal) / peers.length; // 0..1, 1 = cheapest
      valueScore = cheaperPctl * 100;
      metrics.peSectorPercentile = round((1 - cheaperPctl) * 100, 1); // conventional: high = expensive
      metrics.pePeerCount = peers.length;
      explanations.push(
        `P/E ${round(f.pe, 1)} is cheaper than ${round(cheaperPctl * 100, 0)}% of sector peers (${peers.length})`,
      );
    }

    // ── GROWTH: TTM EPS YoY, saturating at ±growthCapPct ──
    let growthScore: number | null = null;
    if (f.ttmEps !== null && f.ttmEpsPrevYear !== null) {
      if (f.ttmEpsPrevYear > 0) {
        const growthPct = ((f.ttmEps - f.ttmEpsPrevYear) / f.ttmEpsPrevYear) * 100;
        growthScore = 50 + clamp(growthPct / growthCapPct, -1, 1) * 50;
        metrics.ttmEpsYoYGrowthPct = round(growthPct, 1);
        explanations.push(`TTM EPS ${round(f.ttmEpsPrevYear, 2)} → ${round(f.ttmEps, 2)} YoY (${round(growthPct, 1)}%)`);
      } else if (f.ttmEps > 0) {
        growthScore = 100;
        metrics.epsTurnaround = true;
        explanations.push(`turnaround: TTM EPS ${round(f.ttmEpsPrevYear, 2)} → ${round(f.ttmEps, 2)} (loss to profit)`);
      } else {
        explanations.push('loss-making both years — growth undefined, component dropped');
      }
    } else {
      explanations.push(`EPS trend needs 8 known quarters (have ${f.quartersKnown}) — growth component dropped`);
    }

    // ── Composite over present components (weights renormalized) ──
    const parts: { s: number; w: number }[] = [];
    if (valueScore !== null) parts.push({ s: valueScore, w: valueWeight });
    if (growthScore !== null) parts.push({ s: growthScore, w: growthWeight });
    if (!parts.length) {
      return {
        score: 50,
        agreementContribution: 0,
        explanations: [...explanations, 'no scoreable fundamental component — neutral'],
        metrics,
      };
    }
    const wSum = parts.reduce((a, p) => a + p.w, 0);
    const score = round(parts.reduce((a, p) => a + p.s * p.w, 0) / wSum, 2);

    if (valueScore !== null) metrics.valueScore = round(valueScore, 2);
    if (growthScore !== null) metrics.growthScore = round(growthScore, 2);
    if (f.resultsPending) explanations.push('⚠️ results pending — a quarter has ended, numbers not yet public');

    return {
      score,
      agreementContribution: round((score - 50) / 50, 4),
      explanations,
      metrics,
    };
  }
}
