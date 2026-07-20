import {
  benchmarkReturn,
  computeMetrics,
  generateRawSignals,
  loadCandleStore,
  simulateSignals,
  DEFAULT_SIMULATOR_CONFIG,
  type CandleStore,
  type SimulatorConfig,
} from '@/backtest';
import { createProductionStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * B14 — Horizon sweep. Read-only.
 *
 *   bun run backtest:horizon
 *
 * WHY: four independent studies (B5/B7 floors, B11 allocation, B12 events, B13
 * delivery) found levers that trim the LEFT tail and nothing that finds large
 * winners at a 2–7 day horizon. But every drift signal that *did* show up —
 * ORDER_WIN, RATING_ACTION, delivery surge — was **strongest at the longest
 * horizon measured (10d)**. That is the evidence pointing here.
 *
 * THE TRAP THIS SCRIPT EXISTS TO AVOID: raising `timeStopDays` alone does not
 * lengthen holds. The thesis-break rule ("2 closes below EMA20, or a MACD
 * histogram flip") is a 7-day thesis; over 30–60 days nearly every name trips
 * it, so it — not the time stop — becomes the binding exit. A naive sweep would
 * report "longer horizons don't help" while never actually holding longer.
 * (Pinned by tests in `tradeSimulator.test.ts`.) So each horizon variant scales
 * the exit rule *together*: trend reference, patience, and targets.
 *
 * The exit-reason mix is printed for every row precisely so a reader can verify
 * the intended horizon was actually reached rather than assumed.
 */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

type Variant = {
  label: string;
  targetRr: [number, number];
  sim: SimulatorConfig;
};

/**
 * Horizon variants. Targets widen with the horizon: a 2R target that a 7-day
 * hold reaches is left on the table by a 45-day hold, and the whole point is to
 * give drift room to develop.
 */
const VARIANTS: Variant[] = [
  // The incumbent, for reference — exactly the published config.
  { label: '7d (incumbent)', targetRr: [2, 3], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 7 } },
  // Naive controls: time stop raised but the 7-day thesis rule left intact.
  // These should show holding periods barely moving — the trap, made visible.
  { label: '21d naive', targetRr: [2, 3], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 21 } },
  { label: '45d naive', targetRr: [2, 3], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 45 } },
  // Properly scaled: longer trend reference, more patience, no MACD hair-trigger.
  { label: '21d scaled', targetRr: [3, 5], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 21, emaPeriod: 50, closesBelowEmaExit: 3, macdFlipExit: false } },
  { label: '30d scaled', targetRr: [3, 5], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 30, emaPeriod: 50, closesBelowEmaExit: 4, macdFlipExit: false } },
  { label: '45d scaled', targetRr: [4, 6], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 45, emaPeriod: 50, closesBelowEmaExit: 5, macdFlipExit: false } },
  { label: '60d scaled', targetRr: [4, 8], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 60, emaPeriod: 50, closesBelowEmaExit: 5, macdFlipExit: false } },
  // Trend-following shape: let winners run, only the trend reference stops you out.
  { label: '60d trend-only', targetRr: [6, 12], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 60, emaPeriod: 50, closesBelowEmaExit: 3, macdFlipExit: false } },
  { label: '90d trend-only', targetRr: [6, 12], sim: { ...DEFAULT_SIMULATOR_CONFIG, timeStopDays: 90, emaPeriod: 50, closesBelowEmaExit: 3, macdFlipExit: false } },
];

const run = async () => {
  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} · ${store.tradingDates.length} trading days.`);

  // Signals are generated ONCE from the production strategy — every variant
  // re-simulates the identical signal set, so differences are exits alone.
  console.log('Replaying the production strategy once (the expensive pass)…');
  const signals = generateRawSignals(store, { strategy: createProductionStrategy() });
  console.log(`${signals.length} raw signals.\n`);

  const bench = benchmarkReturn(store, store.tradingDates[205]!, store.tradingDates.at(-1)!);

  console.log(`=== HORIZON SWEEP · production config · deep window ===`);
  console.log(`  Watch 'avg hold' and the exit mix: a variant whose hold did not move never`);
  console.log(`  actually tested its horizon (thesis-break bound it) — see the naive rows.`);
  console.log(
    `  ${padE('variant', 16)} ${pad('trades', 7)} ${pad('win%', 6)} ${pad('exp%', 8)} ${pad('PF', 6)} ` +
      `${pad('avg hold', 9)} ${pad('p90', 8)}  exit mix (stop/T1/T2/time/thesis)`,
  );

  for (const v of VARIANTS) {
    const trades = simulateSignals(store, signals, { targetRr: v.targetRr, simulatorConfig: v.sim });
    if (trades.length === 0) continue;
    const m = computeMetrics(trades);
    const avgHold = trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length;

    const rets = trades.map((t) => t.netReturnPct).sort((a, b) => a - b);
    const p90 = rets[Math.min(rets.length - 1, Math.floor(rets.length * 0.9))] ?? 0;

    const mix = { stop: 0, t2: 0, time: 0, thesis: 0, other: 0 };
    for (const t of trades) {
      if (t.finalReason === 'stop-loss') mix.stop++;
      else if (t.finalReason === 'target2') mix.t2++;
      else if (t.finalReason === 'time-stop') mix.time++;
      else if (t.finalReason === 'thesis-break') mix.thesis++;
      else mix.other++;
    }

    console.log(
      `  ${padE(v.label, 16)} ${pad(m.totalTrades, 7)} ${pad(m.winRatePct, 6)} ${pad(pct(m.expectancyPct), 8)} ` +
        `${pad(m.profitFactor, 6)} ${pad(avgHold.toFixed(1) + 'd', 9)} ${pad(pct(p90), 8)}  ` +
        `${mix.stop}/${mix.t2}/${mix.time}/${mix.thesis}/${mix.other}`,
    );
  }

  if (bench) {
    console.log(`\n  Nifty B&H over the same window: ${pct(bench.returnPct)}%`);
  }
  console.log(
    `\n  ⚠️ SIGNAL-EDGE units (every signal taken, no 2-position cap) — not comparable to` +
      `\n     B&H and not a portfolio result. Entries are unchanged: this sweep varies ONLY` +
      `\n     the exits, so it answers "does this signal set pay better with room to run?"` +
      `\n     and nothing else. A promising row must then clear the anchored walk-forward` +
      `\n     and the portfolio gate — a single-window sweep has flattered this project before.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
