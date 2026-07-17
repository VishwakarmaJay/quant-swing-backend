import type { FactorResult, FeatureBundle } from '@/factors';
import { round } from '@/factors/indicators';
import { MarketRegime } from '@/regime';

import { WeightedStrategy } from './weightedStrategy';
import type { GateResult, Strategy, StrategyEvaluation } from './types';

/**
 * BullPullbackStrategy — EXPERIMENTAL entry variant for the BULL regime only
 * (HANDOFF Step 4b). Step-1/Step-4 findings: the production "buy trend strength"
 * entry loses in BULL and no filter fixes it — the *surviving* filtered trades
 * are no better. The hypothesis this tests is that BULL needs a **different
 * entry style**: buy the uptrend on a *pullback* (price dipped back to ~EMA20,
 * RSI cooled into a low band) rather than at fresh, extended highs.
 *
 * In every regime other than BULL it delegates byte-for-byte to the injected
 * base strategy (default WeightedStrategy), so only the BULL entry changes.
 *
 * GRADUATED (ROADMAP B2): the pullback+resumption variant earned its keep on
 * walk-forward (Step 4b-v2 / Phase 6) and now runs in production via
 * `createProductionStrategy()` (see `productionStrategy.ts`). It remains the
 * measurement vehicle for the `backtest:pullback` / `backtest:phase6` harnesses.
 */

export type BullPullbackConfig = {
  /** Pullback RSI band (cooled, not crashed). */
  rsiMin: number;
  rsiMax: number;
  /** Max % the close may sit above EMA20 — small/negative = a dip, not extension. */
  maxExtensionAbovePct: number;
  /** Require the EMA20 > EMA50 > EMA200 stack (uptrend intact under the dip). */
  requireStack: boolean;
  /** Require close > EMA50 (hasn't broken the trend). */
  requireAboveEma50: boolean;
  /** v2 resumption: require RSI to have ticked up vs the prior bar (dip ending). */
  requireRsiRising: boolean;
  /** v2 resumption: require the MACD histogram to be rising vs the prior bar. */
  requireHistogramRising: boolean;
};

export const DEFAULT_BULL_PULLBACK_CONFIG: BullPullbackConfig = {
  rsiMin: 40,
  rsiMax: 55,
  maxExtensionAbovePct: 2,
  requireStack: true,
  requireAboveEma50: true,
  requireRsiRising: false,
  requireHistogramRising: false,
};

const num = (r: FactorResult | undefined, key: string): number | null => {
  const v = r?.metrics[key];
  return typeof v === 'number' ? v : null;
};

export class BullPullbackStrategy implements Strategy {
  constructor(
    private readonly config: BullPullbackConfig = DEFAULT_BULL_PULLBACK_CONFIG,
    private readonly base: Strategy = new WeightedStrategy(),
  ) {}

  evaluate(bundle: FeatureBundle, regime: MarketRegime): StrategyEvaluation {
    const evaluation = this.base.evaluate(bundle, regime);
    if (regime !== MarketRegime.BULL) return evaluation;

    const cfg = this.config;
    const close = num(bundle.results.trend, 'close');
    const emaFast = num(bundle.results.trend, 'emaFast');
    const emaMid = num(bundle.results.trend, 'emaMid');
    const emaSlow = num(bundle.results.trend, 'emaSlow');
    const rsi = num(bundle.results.momentum, 'rsi');
    const rsiPrev = num(bundle.results.momentum, 'rsiPrev');
    const histogram = num(bundle.results.momentum, 'histogram');
    const histogramPrev = num(bundle.results.momentum, 'histogramPrev');

    const extensionPct =
      close != null && emaFast != null && emaFast > 0 ? ((close - emaFast) / emaFast) * 100 : null;

    const gates: GateResult[] = [
      {
        name: 'uptrend-stack',
        passed: !cfg.requireStack || (emaFast != null && emaMid != null && emaSlow != null && emaFast > emaMid && emaMid > emaSlow),
        detail:
          emaFast == null || emaMid == null || emaSlow == null
            ? 'EMAs unavailable'
            : `EMA20 ${round(emaFast)} / EMA50 ${round(emaMid)} / EMA200 ${round(emaSlow)}`,
      },
      {
        name: 'above-ema50',
        passed: !cfg.requireAboveEma50 || (close != null && emaMid != null && close > emaMid),
        detail: close == null || emaMid == null ? 'unavailable' : `close ${round(close)} vs EMA50 ${round(emaMid)}`,
      },
      {
        name: 'pullback-not-extended',
        passed: extensionPct != null && extensionPct <= cfg.maxExtensionAbovePct,
        detail:
          extensionPct == null
            ? 'unavailable'
            : `close is ${round(extensionPct, 2)}% vs EMA20 (max ${cfg.maxExtensionAbovePct}%)`,
      },
      {
        name: 'pullback-rsi',
        passed: rsi != null && rsi >= cfg.rsiMin && rsi <= cfg.rsiMax,
        detail: rsi == null ? 'RSI unavailable' : `RSI ${round(rsi, 2)} vs [${cfg.rsiMin}, ${cfg.rsiMax}]`,
      },
    ];

    // v2 resumption confirmation: the dip must be turning back up, not still falling.
    if (cfg.requireRsiRising) {
      gates.push({
        name: 'rsi-rising',
        passed: rsi != null && rsiPrev != null && rsi > rsiPrev,
        detail: rsi == null || rsiPrev == null ? 'RSI slope unavailable' : `RSI ${round(rsi, 2)} vs prev ${round(rsiPrev, 2)}`,
      });
    }
    if (cfg.requireHistogramRising) {
      gates.push({
        name: 'histogram-rising',
        passed: histogram != null && histogramPrev != null && histogram > histogramPrev,
        detail:
          histogram == null || histogramPrev == null
            ? 'MACD slope unavailable'
            : `histogram ${round(histogram, 3)} vs prev ${round(histogramPrev, 3)}`,
      });
    }

    const firstFailed = gates.find((g) => !g.passed);
    const passed = firstFailed === undefined;

    return {
      ...evaluation,
      passed,
      rejectionReason: passed ? null : `bull-pullback:${firstFailed!.name}`,
      gates,
      explanations: passed
        ? [`BULL pullback entry: dip to EMA20 (${round(extensionPct ?? 0, 2)}%), RSI ${round(rsi ?? 0, 2)}, uptrend intact`]
        : [`REJECT (${firstFailed!.name}): ${firstFailed!.detail}`],
    };
  }
}
