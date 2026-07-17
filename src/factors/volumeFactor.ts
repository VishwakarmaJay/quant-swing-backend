import { round, smaLatest } from './indicators';
import { FactorCategory, type Factor, type FactorOutput, type StockContext } from './types';

/**
 * VolumeFactor — volume-confirmed price direction (docs SPRINT_02: "vs 20D
 * avg"). Relative volume = the recent window's average volume ÷ the 20-day
 * average; that conviction is applied in the direction of the recent price
 * move:
 *   up move  + above-average volume → accumulation → toward 100
 *   down move + above-average volume → distribution → toward 0
 *   any move on average/thin volume  → unconfirmed  → 50 (neutral)
 * Volume alone is not bullish/bearish, so an above-average reading only
 * *amplifies* the price direction — it never flips it. Deterministic;
 * config-driven. Index rows (volume 0) return the insufficient branch.
 */

export type VolumeFactorConfig = {
  /** Baseline window — the "20D average". */
  lookback: number;
  /** Recent window whose volume + return are judged against the baseline. */
  priceWindow: number;
  /** Relative-volume excess giving full conviction (1.0 → 2× average = full). */
  convictionCap: number;
};

export const DEFAULT_VOLUME_CONFIG: VolumeFactorConfig = {
  lookback: 20,
  priceWindow: 5,
  convictionCap: 1.0,
};

export class VolumeFactor implements Factor {
  readonly name = 'volume';
  readonly category = FactorCategory.VOLUME;

  constructor(private readonly config: VolumeFactorConfig = DEFAULT_VOLUME_CONFIG) {}

  evaluate(ctx: StockContext): FactorOutput {
    const { lookback, priceWindow, convictionCap } = this.config;
    const closes = ctx.candles.map((c) => c.close);
    const volumes = ctx.candles.map((c) => c.volume);

    const baseVol = smaLatest(volumes, lookback);
    const recentVol = smaLatest(volumes, priceWindow);

    // Not enough history, or no volume at all (index rows) → can't confirm.
    if (
      closes.length < lookback + 1 ||
      baseVol === null ||
      recentVol === null ||
      baseVol <= 0
    ) {
      return {
        score: 0,
        agreementContribution: 0,
        explanations: [
          baseVol !== null && baseVol <= 0
            ? 'no volume data (index or illiquid) — cannot confirm'
            : `insufficient history for volume (need ${lookback + 1}, have ${closes.length})`,
        ],
        metrics: { candles: closes.length },
      };
    }

    const relVol = recentVol / baseVol;
    const startClose = closes[closes.length - 1 - priceWindow]!;
    const endClose = closes[closes.length - 1]!;
    const recentReturn = startClose > 0 ? (endClose - startClose) / startClose : 0;
    const dir = Math.sign(recentReturn); // −1 / 0 / +1
    const conviction = Math.max(0, Math.min(1, (relVol - 1) / convictionCap));

    const score = round(50 + dir * conviction * 50, 2);
    const retPct = round(recentReturn * 100, 2);

    const explanations = [`Last ${priceWindow}d volume ${round(relVol, 2)}× the ${lookback}D average`];
    if (conviction > 0 && dir > 0)
      explanations.push(`Price +${retPct}% on above-average volume (accumulation)`);
    else if (conviction > 0 && dir < 0)
      explanations.push(`Price ${retPct}% on above-average volume (distribution)`);
    else if (dir !== 0)
      explanations.push(`Price ${retPct}% but volume not elevated — move unconfirmed`);
    else explanations.push(`Flat over ${priceWindow}d`);

    return {
      score,
      agreementContribution: round((score - 50) / 50, 4),
      explanations,
      metrics: {
        relVol: round(relVol, 2),
        recentAvgVol: round(recentVol),
        avg20Vol: round(baseVol),
        recentReturnPct: retPct,
        latestVolume: round(volumes.at(-1)!),
        lookback,
        priceWindow,
      },
    };
  }
}
