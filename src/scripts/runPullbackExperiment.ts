import {
  computeMetrics,
  generateRawSignals,
  loadCandleStore,
  simulateSignalsPaired,
  type CandleStore,
  type SignalTrade,
} from '@/backtest';
import { MarketRegime } from '@/regime';
import { BullPullbackStrategy, WeightedStrategy, type BullPullbackConfig } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * BULL pullback-entry experiment (HANDOFF Step 4b). Read-only.
 *
 *   bun run backtest:pullback
 *
 * Tests the hypothesis that BULL needs a *different* entry style — buy the
 * uptrend on a pullback to ~EMA20 with RSI cooled — rather than at extended
 * highs. Only the BULL entry changes; other regimes delegate to the production
 * WeightedStrategy. The bar to clear is **raising BULL expectancy** (a genuine
 * fix), not merely cutting BULL trade count (avoidance, which we already know
 * gets to breakeven — see REGIME_ENTRIES.md).
 */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

type Variant = { label: string; config: BullPullbackConfig };

// Best v1 (static dip) config from Step 4b, then v2 layers resumption confirmation on it.
const V1_BEST = { rsiMin: 35, rsiMax: 50, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true };
const off = { requireRsiRising: false, requireHistogramRising: false };

const VARIANTS: Variant[] = [
  { label: 'v1 rsi35-50 ext≤2% (best)', config: { ...V1_BEST, ...off } },
  { label: 'v2 + RSI rising', config: { ...V1_BEST, requireRsiRising: true, requireHistogramRising: false } },
  { label: 'v2 + histogram rising', config: { ...V1_BEST, requireRsiRising: false, requireHistogramRising: true } },
  { label: 'v2 + both rising', config: { ...V1_BEST, requireRsiRising: true, requireHistogramRising: true } },
  { label: 'v2 rsi40-55 + hist rising', config: { rsiMin: 40, rsiMax: 55, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true, requireRsiRising: false, requireHistogramRising: true } },
];

const regimeSlice = (pairs: SignalTrade[], regime: MarketRegime) => {
  const sub = pairs.filter((p) => p.signal.evaluation.regime === regime);
  return { n: sub.length, m: computeMetrics(sub.map((p) => p.trade)) };
};

const run = async () => {
  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} stocks, ${store.tradingDates.length} trading days.\n`);

  const measure = (label: string, strategy: WeightedStrategy | BullPullbackStrategy) => {
    const signals = generateRawSignals(store, { strategy });
    const pairs = simulateSignalsPaired(store, signals);
    return {
      label,
      signals: signals.length,
      all: computeMetrics(pairs.map((p) => p.trade)),
      bull: regimeSlice(pairs, MarketRegime.BULL),
      side: regimeSlice(pairs, MarketRegime.SIDEWAYS),
    };
  };

  const base = measure('baseline (strength)', new WeightedStrategy());
  const rows = [base, ...VARIANTS.map((v) => measure(v.label, new BullPullbackStrategy(v.config)))];

  console.log(`=== BULL pullback-entry experiment ===`);
  console.log(`  Success = BULL exp RISES above the −0.67 baseline (a real fix), not just fewer BULL trades.\n`);
  console.log(
    `  ${padE('BULL entry', 24)} ${pad('sigs', 6)} ${pad('overall exp', 12)} ${pad('PF', 5)}   ` +
      `${pad('BULL n', 7)} ${pad('BULL exp', 9)} ${pad('PF', 5)}   ${pad('SIDE n', 7)} ${pad('exp', 7)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${padE(r.label, 24)} ${pad(r.signals, 6)} ${pad(pct(r.all.expectancyPct), 12)} ${pad(r.all.profitFactor, 5)}   ` +
        `${pad(r.bull.n, 7)} ${pad(pct(r.bull.m.expectancyPct), 9)} ${pad(r.bull.m.profitFactor, 5)}   ` +
        `${pad(r.side.n, 7)} ${pad(pct(r.side.m.expectancyPct), 7)}`,
    );
  }

  // ── Out-of-sample check: the best config was picked from a grid, so split the window
  // in half (train = first, test = second) and confirm the edge survives on unseen data. ──
  const warmup = 205;
  const total = store.tradingDates.length;
  const mid = Math.floor((warmup + total) / 2);

  const windowMeasure = (strategy: WeightedStrategy | BullPullbackStrategy, from: number, to: number) => {
    const pairs = simulateSignalsPaired(store, generateRawSignals(store, { strategy, fromIndex: from, toIndex: to }));
    const all = computeMetrics(pairs.map((p) => p.trade));
    const bull = regimeSlice(pairs, MarketRegime.BULL);
    return { all, bull };
  };

  const oosConfigs: { label: string; strategy: WeightedStrategy | BullPullbackStrategy }[] = [
    { label: 'baseline (strength)', strategy: new WeightedStrategy() },
    { label: 'v2 rsi40-55 + hist rising', strategy: new BullPullbackStrategy({ rsiMin: 40, rsiMax: 55, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true, requireRsiRising: false, requireHistogramRising: true }) },
  ];

  console.log(`\n=== OUT-OF-SAMPLE CHECK (train = days ${warmup}–${mid}, test = ${mid}–${total}) ===`);
  console.log(`  A real edge survives on the unseen TEST half; a curve-fit one collapses.`);
  console.log(`  ${padE('config', 26)} ${pad('train overall', 14)} ${pad('train BULL', 11)}   ${pad('TEST overall', 13)} ${pad('TEST BULL', 11)}`);
  for (const c of oosConfigs) {
    const tr = windowMeasure(c.strategy, warmup, mid);
    const te = windowMeasure(c.strategy, mid, total);
    console.log(
      `  ${padE(c.label, 26)} ${pad(`${pct(tr.all.expectancyPct)} (PF ${tr.all.profitFactor})`, 14)} ${pad(`${pct(tr.bull.m.expectancyPct)}`, 11)}   ` +
        `${pad(`${pct(te.all.expectancyPct)} (PF ${te.all.profitFactor})`, 13)} ${pad(`${pct(te.bull.m.expectancyPct)}`, 11)}`,
    );
  }

  console.log(
    `\n  ⚠️ Technicals-only, survivorship bias, signal-edge (no 2-position cap). v1 has no` +
      `\n     resumption confirmation (RSI/MACD turning up) — a static dip snapshot. If BULL exp stays` +
      `\n     negative here too, the signal set likely holds no good BULL entries of any style.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
