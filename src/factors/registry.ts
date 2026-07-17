import { MomentumFactor } from './momentumFactor';
import { TrendFactor } from './trendFactor';
import { VolatilityFactor } from './volatilityFactor';
import { VolumeFactor } from './volumeFactor';
import type { Factor } from './types';

/**
 * The registered factors (composition root). Plug-and-play: adding a factor is
 * adding it here — the runner iterates this list, nothing else changes. Order
 * is stable so reports and snapshots read consistently.
 */
export const factors: readonly Factor[] = [
  new TrendFactor(),
  new MomentumFactor(),
  new VolumeFactor(),
  new VolatilityFactor(),
];
