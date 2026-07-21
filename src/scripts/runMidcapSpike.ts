import {
  benchmarkReturn,
  generateRawSignals,
  loadCandleStore,
  makeExpandingFolds,
  simulatePortfolio,
  DEFAULT_PORTFOLIO_SIM_CONFIG,
  DEFAULT_SIMULATOR_CONFIG,
  type CandleStore,
  type SizingMode,
} from '@/backtest';
import { BullPullbackStrategy, DEFAULT_STRATEGY_CONFIG, WeightedStrategy, type Strategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Option-B spike — the B9 strategy on a point-in-time Nifty Midcap 150 universe
 * (docs/MIDCAP_SPIKE.md). Read-only. `bun run midcap:spike` (after `midcap:ingest`).
 *
 * The go/no-go question: does the existing large-cap strategy show ANY edge
 * down-cap, BEFORE investing in news/fundamentals for these names? Sentiment &
 * fundamental floors read neutral-50 here (no archive for midcaps) so they pass —
 * the effective strategy is `pullback + srs0.25 − volume`.
 *
 * FAIR BENCHMARK: beating Nifty-50 with midcaps in a bull tape is just beta, so
 * the bar is the **point-in-time equal-weight midcap B&H** (survivorship-correct:
 * only names trading that day) — "did selection beat holding the segment?". Nifty
 * B&H is shown too, for reference. RS factor + regime still use Nifty (market-wide).
 */

const WARMUP = 205;
const COVERAGE_FROM = '2024-07-01';

const withSrs = (w: number, opts: { fundamentalFloor?: number; sentimentFactorFloor?: number; dropVolume?: boolean } = {}) => {
  const weights: Record<string, number> = { ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights, sectorRelativeStrength: w };
  if (opts.dropVolume) delete weights.volume;
  return new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    technicalFactorWeights: weights,
    ...(opts.fundamentalFloor != null ? { fundamentalFloor: opts.fundamentalFloor } : {}),
    ...(opts.sentimentFactorFloor != null ? { sentimentFactorFloor: opts.sentimentFactorFloor } : {}),
  });
};
const pullbackV2 = { rsiMin: 40, rsiMax: 55, maxExtensionAbovePct: 2, requireStack: true, requireAboveEma50: true, requireRsiRising: false, requireHistogramRising: true };

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

/** Point-in-time equal-weight midcap B&H return (%) over [fromIndex, end]. */
const equalWeightReturn = (store: CandleStore, fromIndex: number): number => {
  const dates = store.tradingDates;
  const closeByDate = store.instruments.map((i) => new Map((store.seriesById.get(i.id) ?? []).map((c) => [c.tradeDate, c.close])));
  let index = 100;
  for (let d = fromIndex + 1; d < dates.length; d++) {
    const cur = dates[d]!, prev = dates[d - 1]!;
    let sum = 0, n = 0;
    for (const m of closeByDate) {
      const a = m.get(prev), b = m.get(cur);
      if (a != null && b != null && a > 0) { sum += b / a - 1; n++; }
    }
    if (n > 0) index *= 1 + sum / n;
  }
  return (index / 100 - 1) * 100;
};

const run = async () => {
  console.log('Loading MIDCAP candles…');
  const store = await loadCandleStore({ universeType: 'EQ_MID' });
  const total = store.tradingDates.length;
  const oosFrom = makeExpandingFolds(WARMUP, total, 3)[0]!.testFrom;
  const coverageFrom = store.tradingDates.findIndex((d) => d >= COVERAGE_FROM);
  console.log(`Universe ${store.instruments.length} midcaps · ${total} trading days.`);
  console.log(`Windows: FULL ${store.tradingDates[WARMUP]}→${store.tradingDates[total - 1]} · OOS ${store.tradingDates[oosFrom]}→ · COVERAGE ${store.tradingDates[coverageFrom]}→\n`);

  const strategies: { key: string; label: string; strategy: Strategy }[] = [
    { key: 'baseline', label: 'baseline (production)', strategy: new WeightedStrategy() },
    { key: 'b9stack', label: 'b9 stack (ff50+sf50-novol)', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25, { fundamentalFloor: 50, sentimentFactorFloor: 50, dropVolume: true })) },
  ];
  const windows = [
    { key: 'FULL', fromIndex: WARMUP },
    { key: 'OOS', fromIndex: oosFrom },
    { key: 'COVERAGE', fromIndex: coverageFrom },
  ];
  const sizings: SizingMode[] = ['flat', 'risk'];

  console.log('Replaying pipeline per strategy/window…');
  const signalsFor = new Map<string, ReturnType<typeof generateRawSignals>>();
  for (const s of strategies) for (const w of windows) signalsFor.set(`${s.key}:${w.key}`, generateRawSignals(store, { strategy: s.strategy, fromIndex: w.fromIndex }));

  const header = `  ${padE('strategy', 26)} ${padE('sizing', 6)} ${pad('final', 11)} ${pad('ret%', 8)} ${pad('CAGR%', 7)} ${pad('maxDD%', 7)} ${pad('expo%', 6)} ${pad('trades', 7)} ${pad('win%', 6)}`;
  for (const w of windows) {
    const from = store.tradingDates[w.fromIndex]!, to = store.tradingDates[total - 1]!;
    const niftyBench = benchmarkReturn(store, from, to);
    const ewi = equalWeightReturn(store, w.fromIndex);
    console.log(`\n=== ${w.key} window (${from} → ${to}) · ₹2,00,000 base · 1× costs ===`);
    console.log(header);
    for (const s of strategies) {
      for (const sizing of sizings) {
        const r = simulatePortfolio(store, signalsFor.get(`${s.key}:${w.key}`)!, { ...DEFAULT_PORTFOLIO_SIM_CONFIG, sizingMode: sizing }, { fromIndex: w.fromIndex, simulatorConfig: DEFAULT_SIMULATOR_CONFIG });
        const m = r.metrics;
        console.log(`  ${padE(s.label, 26)} ${padE(sizing, 6)} ${pad(inr(m.finalEquity), 11)} ${pad(pct(m.totalReturnPct), 8)} ${pad(pct(m.cagrPct), 7)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.exposureAvgPct.toFixed(0), 6)} ${pad(m.tradesTaken, 7)} ${pad(m.winRatePct.toFixed(1), 6)}`);
      }
    }
    console.log(`  ${padE('MIDCAP-EWI B&H (the bar)', 26)} ${padE('—', 6)} ${pad(inr(200000 * (1 + ewi / 100)), 11)} ${pad(pct(ewi), 8)}   ← survivorship-correct equal-weight midcap`);
    if (niftyBench) console.log(`  ${padE('NIFTY B&H (reference)', 26)} ${padE('—', 6)} ${pad(inr(200000 * (1 + niftyBench.returnPct / 100)), 11)} ${pad(pct(niftyBench.returnPct), 8)}`);
  }
  console.log(`\n  ⚠️ Spike: technicals-only (no midcap news/fundamentals; floors neutral-pass). Fixed 2021-03 cohort,`);
  console.log(`     candles bounded to index-exit (±1 reconstitution). The bar is MIDCAP-EWI, not Nifty.`);
};

run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
