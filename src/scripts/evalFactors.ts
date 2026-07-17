import {
  buildFeatureBundle,
  buildStockContext,
  factors,
  loadBenchmarkCandles,
  loadSectorPeerReturns,
} from '@/factors';
import { prisma } from '@services/prisma';

/**
 * Evaluate the registered factors across a universe and print a compact,
 * ranked table (one line per instrument). Read-only.
 *
 *   bun run factors:eval             # whole equity universe (default)
 *   bun run factors:eval indices     # the 3 underlying indices
 *   bun run factors:eval RELIANCE    # one instrument by name
 */

const scopeWhere = (arg?: string) => {
  switch ((arg ?? '').toLowerCase()) {
    case '':
    case 'equities':
    case 'eq':
      return { instrumentType: 'EQ' };
    case 'all':
      return { instrumentType: { in: ['EQ', 'AMXIDX'] } };
    case 'indices':
    case 'index':
      return { instrumentType: 'AMXIDX' };
    default:
      return { name: arg!.toUpperCase() };
  }
};

const cell = (v: number) => (Number.isFinite(v) ? v.toFixed(0).padStart(5) : '   —');

const run = async () => {
  const [scopeArg] = process.argv.slice(2);
  const instruments = await prisma.instrument.findMany({
    where: scopeWhere(scopeArg),
    orderBy: { name: 'asc' },
  });

  if (!instruments.length) {
    console.error('No matching instruments — run "bun run sync:instruments" / "backfill:ohlcv" first.');
    process.exitCode = 1;
    return;
  }

  // Load the Nifty benchmark + sector peer returns once and reuse per stock.
  const benchmarkCandles = await loadBenchmarkCandles();
  const sectorPeerReturns = await loadSectorPeerReturns();

  type Row = {
    symbol: string;
    sector: string;
    trend: number;
    momentum: number;
    rs: number;
    srs: number;
    volume: number;
    volatility: number;
    dq: number;
    n: number;
  };
  const rows: Row[] = [];

  for (const inst of instruments) {
    const ctx = await buildStockContext(inst.id, new Date(), { benchmarkCandles, sectorPeerReturns });
    if (!ctx) continue;
    const bundle = buildFeatureBundle(ctx, factors);
    rows.push({
      symbol: inst.symbol.replace(/-EQ$/, ''),
      sector: inst.sector ?? '—',
      trend: bundle.results.trend?.score ?? NaN,
      momentum: bundle.results.momentum?.score ?? NaN,
      rs: bundle.results.relativeStrength?.score ?? NaN,
      srs: bundle.results.sectorRelativeStrength?.score ?? NaN,
      volume: bundle.results.volume?.score ?? NaN,
      volatility: bundle.results.volatility?.score ?? NaN,
      dq: bundle.dataQualityScore,
      n: ctx.candles.length,
    });
  }

  // Rank by trend, then relative strength — strongest setups surface first.
  rows.sort((a, b) => b.trend - a.trend || b.rs - a.rs);

  console.log(`\nFactors: ${factors.map((f) => f.name).join(', ')}   (${rows.length} instruments)\n`);
  console.log(`  #  SYMBOL         SECTOR                 TRND   MOM    RS   SRS   VOL  VLTY    DQ    N`);
  console.log(`  ${'-'.repeat(90)}`);
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)}  ${r.symbol.padEnd(13)} ${r.sector.slice(0, 20).padEnd(20)} ` +
        `${cell(r.trend)} ${cell(r.momentum)} ${cell(r.rs)} ${cell(r.srs)} ${cell(r.volume)} ${cell(r.volatility)}  ` +
        `${r.dq.toFixed(2)} ${String(r.n).padStart(4)}`,
    );
  });

  const short = rows.filter((r) => r.dq < 0.8).length;
  console.log(`\n  ${rows.length - short} with full history (DQ ≥ 0.8), ${short} short/low-quality.`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
