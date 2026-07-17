import {
  benchmarkReturn,
  generateRawSignals,
  loadCandleStore,
  makeExpandingFolds,
  simulatePortfolio,
  DEFAULT_PORTFOLIO_SIM_CONFIG,
  type CandleStore,
  type RawSignal,
  type SizingMode,
} from '@/backtest';
import { DEFAULT_SIMULATOR_CONFIG } from '@/backtest';
import { BullPullbackStrategy, DEFAULT_STRATEGY_CONFIG, WeightedStrategy, type Strategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * Portfolio-level backtest (ROADMAP B1) — the fair "beat Nifty" gate. Read-only.
 *
 *   bun run backtest:portfolio
 *
 * Runs ONE capital base (₹200k = live 2 × ₹100k) through the signal stream with
 * the real book constraints, and reports CAGR / true max drawdown / exposure in
 * the SAME units as Nifty Buy & Hold. Compares:
 *   strategies : baseline (production) vs combined (pullback-v2 + SRS 0.25 — the
 *                walk-forward-selected config from Phase 6)
 *   windows    : full tradeable window, and the Phase-6 OOS stretch
 *   sizing     : flat vs conviction (composite-scaled) vs risk-based (1% equity)
 *   costs      : 1× (5bps + 0.05%/side) and 2× stress — flags ranking flips
 */

const WARMUP = 205;

const withSrs = (w: number): WeightedStrategy =>
  new WeightedStrategy({
    ...DEFAULT_STRATEGY_CONFIG,
    technicalFactorWeights: { ...DEFAULT_STRATEGY_CONFIG.technicalFactorWeights, sectorRelativeStrength: w },
  });
const pullbackV2 = {
  rsiMin: 40,
  rsiMax: 55,
  maxExtensionAbovePct: 2,
  requireStack: true,
  requireAboveEma50: true,
  requireRsiRising: false,
  requireHistogramRising: true,
};

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  const total = store.tradingDates.length;
  const oosFrom = makeExpandingFolds(WARMUP, total, 3)[0]!.testFrom; // Phase-6 OOS start
  console.log(`Universe ${store.instruments.length} stocks, ${total} trading days.`);
  console.log(
    `Windows: FULL ${store.tradingDates[WARMUP]}→${store.tradingDates[total - 1]} · ` +
      `OOS ${store.tradingDates[oosFrom]}→${store.tradingDates[total - 1]} (Phase-6 test stretch)\n`,
  );

  const strategies: { key: string; label: string; strategy: Strategy }[] = [
    { key: 'baseline', label: 'baseline (production)', strategy: new WeightedStrategy() },
    { key: 'combined', label: 'combined (pullback+srs)', strategy: new BullPullbackStrategy(pullbackV2, withSrs(0.25)) },
  ];
  const windows = [
    { key: 'FULL', fromIndex: WARMUP },
    { key: 'OOS', fromIndex: oosFrom },
  ];
  const sizings: SizingMode[] = ['flat', 'conviction', 'risk'];

  // Generate each strategy's signals once per window (the expensive pass).
  console.log('Replaying pipeline per strategy/window…');
  const signalsFor = new Map<string, RawSignal[]>();
  for (const s of strategies) {
    for (const w of windows) {
      signalsFor.set(`${s.key}:${w.key}`, generateRawSignals(store, { strategy: s.strategy, fromIndex: w.fromIndex }));
    }
  }

  const simulate = (sKey: string, w: { key: string; fromIndex: number }, sizing: SizingMode, costMult: 1 | 2) =>
    simulatePortfolio(
      store,
      signalsFor.get(`${sKey}:${w.key}`)!,
      { ...DEFAULT_PORTFOLIO_SIM_CONFIG, sizingMode: sizing, costPctPerSide: DEFAULT_SIMULATOR_CONFIG.costPctPerSide * costMult },
      {
        fromIndex: w.fromIndex,
        simulatorConfig: {
          ...DEFAULT_SIMULATOR_CONFIG,
          slippageBps: DEFAULT_SIMULATOR_CONFIG.slippageBps * costMult,
          costPctPerSide: DEFAULT_SIMULATOR_CONFIG.costPctPerSide * costMult,
        },
      },
    );

  const header = `  ${padE('strategy', 26)} ${padE('sizing', 11)} ${pad('final', 10)} ${pad('ret%', 8)} ${pad('CAGR%', 7)} ${pad('maxDD%', 7)} ${pad('expo%', 6)} ${pad('trades', 7)} ${pad('win%', 6)}  skips(limit/sector/size/cash/kill)`;

  for (const w of windows) {
    const from = store.tradingDates[w.fromIndex]!;
    const to = store.tradingDates[total - 1]!;
    const bench = benchmarkReturn(store, from, to);
    const benchFinal = bench ? DEFAULT_PORTFOLIO_SIM_CONFIG.initialCapital * (1 + bench.returnPct / 100) : null;

    console.log(`\n=== ${w.key} window (${from} → ${to}) · ₹2,00,000 base · 1× costs ===`);
    console.log(header);
    for (const s of strategies) {
      for (const sizing of sizings) {
        const r = simulate(s.key, w, sizing, 1);
        const m = r.metrics;
        const k = m.skipped;
        console.log(
          `  ${padE(s.label, 26)} ${padE(sizing, 11)} ${pad(inr(m.finalEquity), 10)} ${pad(pct(m.totalReturnPct), 8)} ` +
            `${pad(pct(m.cagrPct), 7)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.exposureAvgPct.toFixed(0), 6)} ` +
            `${pad(m.tradesTaken, 7)} ${pad(m.winRatePct.toFixed(1), 6)}  ${k['position-limit']}/${k['sector-cap']}/${k.sizing}/${k['insufficient-cash']}/${k['kill-switch']}`,
        );
      }
    }
    if (bench && benchFinal) {
      console.log(`  ${padE('NIFTY Buy & Hold', 26)} ${padE('—', 11)} ${pad(inr(benchFinal), 10)} ${pad(pct(bench.returnPct), 8)}   (same window, same capital)`);
    }
  }

  // ── Cost-sensitivity stress: 2× slippage + commissions on the OOS window.
  const oosW = windows[1]!;
  console.log(`\n=== COST SENSITIVITY (OOS window, 2× slippage + commissions) ===`);
  console.log(header);
  const ranks: Record<1 | 2, Record<string, number>> = { 1: {}, 2: {} };
  for (const costMult of [1, 2] as const) {
    for (const s of strategies) {
      const r = simulate(s.key, oosW, 'flat', costMult);
      ranks[costMult][s.key] = r.metrics.totalReturnPct;
      if (costMult === 2) {
        const m = r.metrics;
        const k = m.skipped;
        console.log(
          `  ${padE(s.label, 26)} ${padE('flat', 11)} ${pad(inr(m.finalEquity), 10)} ${pad(pct(m.totalReturnPct), 8)} ` +
            `${pad(pct(m.cagrPct), 7)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.exposureAvgPct.toFixed(0), 6)} ` +
            `${pad(m.tradesTaken, 7)} ${pad(m.winRatePct.toFixed(1), 6)}  ${k['position-limit']}/${k['sector-cap']}/${k.sizing}/${k['insufficient-cash']}/${k['kill-switch']}`,
        );
      }
    }
  }
  const flip =
    Math.sign(ranks[1].combined! - ranks[1].baseline!) !== Math.sign(ranks[2].combined! - ranks[2].baseline!);
  console.log(
    flip
      ? `  ⚠️ RANKING FLIP at 2× costs — the baseline/combined ordering is cost-fragile.`
      : `  Ranking stable at 2× costs (combined ${ranks[2].combined! > ranks[2].baseline! ? 'still beats' : 'still trails'} baseline).`,
  );

  console.log(
    `\n  ⚠️ Same-units comparison at last. Caveats that remain: survivorship bias (today's` +
      `\n     constituents), fixed cost model, trade paths independent of book (no market impact),` +
      `\n     entries before same-day exits (conservative). The B10 gate reads THIS report's OOS` +
      `\n     rows: strategy CAGR must beat Nifty B&H risk-adjusted before paper trading.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
