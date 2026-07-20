import {
  benchmarkReturn,
  generateRawSignals,
  loadCandleStore,
  simulatePortfolio,
  DEFAULT_PORTFOLIO_SIM_CONFIG,
  SENTIMENT_ORIGIN_TIERS,
  type CandleStore,
  type RankKey,
  type SizingMode,
} from '@/backtest';
import { DEFAULT_SIMULATOR_CONFIG } from '@/backtest';
import { createProductionStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

/**
 * B11 — Slot-allocation research. Read-only.
 *
 *   bun run backtest:slots [live|live+bse|all]
 *
 * B1/B9 measured the bottleneck: the 2-slot book takes only ~14% of signals, and
 * *which* 14% is decided by ranking on the composite — which Step-1 proved has
 * ρ≈0 with outcomes. This grid asks two questions the existing simulator can
 * answer with no new modelling:
 *
 *   1. RANK KEY — does any available ordering beat the incumbent? `random` is the
 *      CONTROL: if nothing beats a seeded coin flip, the bottleneck is signal
 *      quality, not allocation, and a portfolio optimizer would be premature.
 *   2. SLOTS DOSE — does simply widening `maxOpenPositions` dominate the ranking
 *      question by diluting it?
 *
 * The decisive column is `selEdge` = mean net-% of trades TAKEN minus mean net-%
 * of candidates SKIPPED for want of a slot. It isolates the ranking's own
 * contribution from the tape: ≈0 means the key carries no information, whatever
 * the headline return does.
 *
 * Signals are generated ONCE from the production strategy; every cell re-runs
 * only the (cheap) book simulation, so the candidate pool is identical
 * throughout — differences are allocation, nothing else.
 */

const WARMUP = 205;
/** The B9 anchored coverage era — where the production floors are actually live. */
const COVERAGE_FROM = '2024-07-01';

const RANK_KEYS: RankKey[] = [
  'composite',
  'random',
  'sentiment',
  'srs',
  'fundamental',
  'calm',
  'tight-stop',
  'agreement',
];
const SLOT_DOSES = [2, 3, 4, 6];

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

const run = async () => {
  const tier = process.argv[2] ?? 'live+bse';
  if (!(tier in SENTIMENT_ORIGIN_TIERS)) {
    console.error(`Unknown origin tier '${tier}' — use one of: ${Object.keys(SENTIMENT_ORIGIN_TIERS).join(' | ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Loading candles… (sentiment origin tier: ${tier})`);
  const store: CandleStore = await loadCandleStore({ sentimentOrigins: SENTIMENT_ORIGIN_TIERS[tier] });
  const total = store.tradingDates.length;
  const coverageFrom = store.tradingDates.findIndex((d) => d >= COVERAGE_FROM);
  console.log(`Universe ${store.instruments.length} stocks, ${total} trading days (tier ${tier}).`);

  // One replay of the production strategy — every cell shares this candidate pool.
  console.log('Replaying the production strategy once (the expensive pass)…');
  const signals = generateRawSignals(store, { strategy: createProductionStrategy() });
  console.log(`${signals.length} raw signals.\n`);

  const windows = [
    { key: 'COVERAGE', fromIndex: coverageFrom },
    { key: 'FULL', fromIndex: WARMUP },
  ];

  const sim = (fromIndex: number, rankKey: RankKey, slots: number, sizing: SizingMode) =>
    simulatePortfolio(
      store,
      signals,
      { ...DEFAULT_PORTFOLIO_SIM_CONFIG, sizingMode: sizing, maxOpenPositions: slots, rankKey },
      { fromIndex, simulatorConfig: DEFAULT_SIMULATOR_CONFIG },
    );

  const header =
    `  ${padE('rank key', 12)} ${pad('final', 10)} ${pad('ret%', 8)} ${pad('CAGR%', 7)} ${pad('maxDD%', 7)} ` +
    `${pad('trades', 7)} ${pad('win%', 6)} ${pad('taken%', 8)} ${pad('skip%', 8)} ${pad('selEdge', 8)} ${pad('skips', 6)}`;

  // ── 1. Rank-key grid (slots held at the live 2, risk sizing = the B9 default).
  for (const w of windows) {
    const from = store.tradingDates[w.fromIndex]!;
    const to = store.tradingDates[total - 1]!;
    const bench = benchmarkReturn(store, from, to);
    console.log(`\n=== 1. RANK KEY · ${w.key} (${from} → ${to}) · 2 slots · risk sizing ===`);
    console.log(`  selEdge = mean net% TAKEN − mean net% SKIPPED-for-slot. ≈0 ⇒ the key is uninformative.`);
    console.log(header);
    for (const rankKey of RANK_KEYS) {
      const m = sim(w.fromIndex, rankKey, 2, 'risk').metrics;
      console.log(
        `  ${padE(rankKey, 12)} ${pad(inr(m.finalEquity), 10)} ${pad(pct(m.totalReturnPct), 8)} ` +
          `${pad(pct(m.cagrPct), 7)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.tradesTaken, 7)} ` +
          `${pad(m.winRatePct.toFixed(1), 6)} ${pad(pct(m.takenNetPctAvg), 8)} ${pad(pct(m.skippedNetPctAvg), 8)} ` +
          `${pad(pct(m.selectionEdgePct), 8)} ${pad(m.skipped['position-limit'], 6)}`,
      );
    }
    if (bench) console.log(`  ${padE('NIFTY B&H', 12)} ${pad(inr(200_000 * (1 + bench.returnPct / 100)), 10)} ${pad(pct(bench.returnPct), 8)}`);
  }

  // ── 2. Slots dose (incumbent key vs the control, to see if width beats ranking).
  const covFrom = windows[0]!.fromIndex;
  console.log(`\n=== 2. SLOTS DOSE · COVERAGE · risk sizing (does width dominate the ranking question?) ===`);
  console.log(`  ${padE('slots', 7)} ${padE('rank key', 12)} ${pad('ret%', 8)} ${pad('CAGR%', 7)} ${pad('maxDD%', 7)} ${pad('expo%', 6)} ${pad('trades', 7)} ${pad('selEdge', 8)} ${pad('skips', 6)}`);
  for (const slots of SLOT_DOSES) {
    for (const rankKey of ['composite', 'random'] as RankKey[]) {
      const m = sim(covFrom, rankKey, slots, 'risk').metrics;
      console.log(
        `  ${padE(slots, 7)} ${padE(rankKey, 12)} ${pad(pct(m.totalReturnPct), 8)} ${pad(pct(m.cagrPct), 7)} ` +
          `${pad(m.maxDrawdownPct.toFixed(1), 7)} ${pad(m.exposureAvgPct.toFixed(0), 6)} ${pad(m.tradesTaken, 7)} ` +
          `${pad(pct(m.selectionEdgePct), 8)} ${pad(m.skipped['position-limit'], 6)}`,
      );
    }
  }

  // ── 3. Best-key × sizing interaction on the honest window.
  console.log(`\n=== 3. SIZING × top keys · COVERAGE · 2 slots ===`);
  console.log(`  ${padE('rank key', 12)} ${padE('sizing', 11)} ${pad('ret%', 8)} ${pad('maxDD%', 7)} ${pad('trades', 7)} ${pad('selEdge', 8)}`);
  for (const rankKey of ['composite', 'random', 'sentiment', 'calm'] as RankKey[]) {
    for (const sizing of ['flat', 'conviction', 'risk'] as SizingMode[]) {
      const m = sim(covFrom, rankKey, 2, sizing).metrics;
      console.log(
        `  ${padE(rankKey, 12)} ${padE(sizing, 11)} ${pad(pct(m.totalReturnPct), 8)} ${pad(m.maxDrawdownPct.toFixed(1), 7)} ` +
          `${pad(m.tradesTaken, 7)} ${pad(pct(m.selectionEdgePct), 8)}`,
      );
    }
  }

  console.log(
    `\n  ⚠️ READ selEdge FIRST, not the headline return. With n≈100–200 taken trades a` +
      `\n     single sequencing accident moves ret% by several points; selEdge is the` +
      `\n     per-trade statement of whether the ordering itself carries information.` +
      `\n     A key only earns further work if it beats 'random' on BOTH windows.` +
      `\n     Survivorship + fixed cost model + single ₹2L base apply as always.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
