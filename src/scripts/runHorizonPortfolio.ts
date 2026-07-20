import {
  benchmarkReturn,
  generateRawSignals,
  loadCandleStore,
  simulatePortfolio,
  DEFAULT_PORTFOLIO_SIM_CONFIG,
  DEFAULT_SIMULATOR_CONFIG,
  type CandleStore,
  type SimulatorConfig,
  type SizingMode,
} from '@/backtest';
import { createProductionStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * B14b — the horizon variants through the PORTFOLIO gate. Read-only.
 *
 *   bun run backtest:horizon:portfolio
 *
 * The signal-edge sweep (B14) showed expectancy and the right tail rising
 * monotonically with holding period. That measurement is in ABSOLUTE net
 * returns, so a longer hold mechanically collects more market beta — over this
 * window Nifty compounded +42.9%, ~0.027%/trading day, which is ~+0.5% on a
 * 20-day hold vs ~+0.09% on a 3-day one. Roughly half the apparent gain could
 * be beta.
 *
 * This script settles it: one ₹2L book against Nifty B&H **in the same units**,
 * so beta is on both sides of the comparison. It also exposes the second-order
 * effect a longer hold has at portfolio level — with 2 slots, holding 28 days
 * instead of 5 means taking far fewer trades, which cuts costs but concentrates
 * risk.
 */
const V: { label: string; targetRr: [number, number]; sim: SimulatorConfig }[] = [
  { label: '7d (incumbent)', targetRr: [2, 3], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 7 } },
  { label: '30d scaled', targetRr: [3, 5], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 30, emaPeriod: 50, closesBelowEmaExit: 4, macdFlipExit: false } },
  { label: '60d trend-only', targetRr: [6, 12], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 60, emaPeriod: 50, closesBelowEmaExit: 3, macdFlipExit: false } },
  { label: '90d trend-only', targetRr: [6, 12], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 90, emaPeriod: 50, closesBelowEmaExit: 3, macdFlipExit: false } },
];
const WARMUP = 205;
const COVERAGE_FROM = '2024-07-01';
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  const store: CandleStore = await loadCandleStore();
  const total = store.tradingDates.length;
  const signals = generateRawSignals(store, { strategy: createProductionStrategy() });
  console.log(`${signals.length} signals · ${total} trading days\n`);

  for (const w of [
    { key: 'FULL', from: WARMUP },
    { key: 'COVERAGE', from: store.tradingDates.findIndex((d) => d >= COVERAGE_FROM) },
  ]) {
    const bench = benchmarkReturn(store, store.tradingDates[w.from]!, store.tradingDates[total - 1]!);
    console.log(`=== ${w.key} (${store.tradingDates[w.from]} → ${store.tradingDates[total - 1]}) · ₹2L book ===`);
    console.log(`  ${padE('variant', 16)} ${padE('sizing', 11)} ${pad('final', 11)} ${pad('ret%', 8)} ${pad('CAGR%', 7)} ${pad('maxDD%', 7)} ${pad('expo%', 6)} ${pad('trades', 7)} ${pad('win%', 6)}`);
    for (const v of V) {
      for (const sizing of ['risk', 'flat'] as SizingMode[]) {
        const r = simulatePortfolio(
          store, signals,
          { ...DEFAULT_PORTFOLIO_SIM_CONFIG, sizingMode: sizing },
          { fromIndex: w.from, targetRr: v.targetRr, simulatorConfig: v.sim },
        );
        const m = r.metrics;
        console.log(`  ${padE(v.label, 16)} ${padE(sizing, 11)} ${pad(inr(m.finalEquity), 11)} ${pad(pct(m.totalReturnPct), 8)} ${pad(pct(m.cagrPct), 7)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.exposureAvgPct.toFixed(0), 6)} ${pad(m.tradesTaken, 7)} ${pad(m.winRatePct.toFixed(1), 6)}`);
      }
    }
    if (bench) console.log(`  ${padE('NIFTY B&H', 16)} ${padE('—', 11)} ${pad(inr(200_000 * (1 + bench.returnPct / 100)), 11)} ${pad(pct(bench.returnPct), 8)}   ← the beta-inclusive bar\n`);
  }
};
run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
