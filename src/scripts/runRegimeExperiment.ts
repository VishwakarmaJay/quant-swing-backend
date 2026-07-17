import {
  computeMetrics,
  generateRawSignals,
  loadCandleStore,
  simulateSignalsPaired,
  type CandleStore,
  type SignalTrade,
} from '@/backtest';
import { MarketRegime } from '@/regime';
import { DEFAULT_STRATEGY_CONFIG, WeightedStrategy, type RegimeGateOverride } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Regime-conditioned entry experiment (HANDOFF Step 4, redirected). Read-only.
 *
 *   bun run backtest:regime
 *
 * Step-1 attribution found BULL is the loss sink (−0.67%/trade, PF 0.61) while
 * SIDEWAYS is ~breakeven. This tests whether tightening entries *in BULL only*
 * (avoid overbought / require sector leadership / skip) improves the strategy —
 * using data already in the DB, so it is immediately backtestable. Each variant
 * is measured overall AND per-regime, so we can tell whether a rule genuinely
 * fixes BULL entries or merely drops trades.
 */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

type Variant = { label: string; overrides: Partial<Record<MarketRegime, RegimeGateOverride>> };

const VARIANTS: Variant[] = [
  { label: 'BULL: skip (diagnostic)', overrides: { [MarketRegime.BULL]: { skip: true } } },
  { label: 'BULL: rsiMax 60', overrides: { [MarketRegime.BULL]: { rsiMax: 60 } } },
  { label: 'BULL: rsiMax 55', overrides: { [MarketRegime.BULL]: { rsiMax: 55 } } },
  { label: 'BULL: sectorRS ≥ 55', overrides: { [MarketRegime.BULL]: { minSectorRs: 55 } } },
  { label: 'BULL: sectorRS ≥ 60', overrides: { [MarketRegime.BULL]: { minSectorRs: 60 } } },
  {
    label: 'BULL: rsiMax60 + sRS≥55',
    overrides: { [MarketRegime.BULL]: { rsiMax: 60, minSectorRs: 55 } },
  },
];

/** Metrics for the subset of pairs whose signal-time regime matches. */
const regimeSlice = (pairs: SignalTrade[], regime: MarketRegime) => {
  const sub = pairs.filter((p) => p.signal.evaluation.regime === regime);
  return { n: sub.length, m: computeMetrics(sub.map((p) => p.trade)) };
};

const run = async () => {
  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days.\n`);

  const measure = (label: string, strategy: WeightedStrategy) => {
    const signals = generateRawSignals(store, { strategy });
    const pairs = simulateSignalsPaired(store, signals);
    const all = computeMetrics(pairs.map((p) => p.trade));
    const bull = regimeSlice(pairs, MarketRegime.BULL);
    const side = regimeSlice(pairs, MarketRegime.SIDEWAYS);
    return { label, signals: signals.length, all, bull, side };
  };

  const base = measure('baseline', new WeightedStrategy());
  const rows = [base, ...VARIANTS.map((v) =>
    measure(v.label, new WeightedStrategy({ ...DEFAULT_STRATEGY_CONFIG, regimeGateOverrides: v.overrides })),
  )];

  console.log(`=== Regime-conditioned entry experiment (Δexp vs baseline overall) ===`);
  console.log(`  Goal: raise OVERALL expectancy; ideally by FIXING bull (raising its exp), not only cutting trades.\n`);
  console.log(
    `  ${padE('variant', 26)} ${pad('sigs', 6)} ${pad('overall exp', 12)} ${pad('PF', 5)} ${pad('Δexp', 7)}   ` +
      `${pad('BULL n', 7)} ${pad('exp', 7)} ${pad('PF', 5)}   ${pad('SIDE n', 7)} ${pad('exp', 7)} ${pad('PF', 5)}`,
  );
  for (const r of rows) {
    const dExp = r.label === 'baseline' ? 0 : r.all.expectancyPct - base.all.expectancyPct;
    console.log(
      `  ${padE(r.label, 26)} ${pad(r.signals, 6)} ${pad(pct(r.all.expectancyPct), 12)} ${pad(r.all.profitFactor, 5)} ${pad(pct(dExp), 7)}   ` +
        `${pad(r.bull.n, 7)} ${pad(pct(r.bull.m.expectancyPct), 7)} ${pad(r.bull.m.profitFactor, 5)}   ` +
        `${pad(r.side.n, 7)} ${pad(pct(r.side.m.expectancyPct), 7)} ${pad(r.side.m.profitFactor, 5)}`,
    );
  }

  console.log(
    `\n  ⚠️ Technicals-only, survivorship bias, signal-edge (no 2-position cap). "skip" is a diagnostic` +
      `\n     upper bound, not a strategy. A rule that only cuts BULL trade count (not raising BULL exp)` +
      `\n     is just avoidance; a rule that RAISES BULL exp is a genuine entry fix.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
