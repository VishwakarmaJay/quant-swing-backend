import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { backAdjustSplits, parseBhavcopyOhlcv, type BhavOhlcvRow } from '@/ohlcv/bhavcopyOhlcv';
import { prisma } from '@services/prisma';

/**
 * Survivorship repair — ingest delisted-name OHLCV from the B13 bhavcopy archive
 * (docs/SURVIVORSHIP.md). Read-mostly; idempotent (upsert).
 *
 *   bun run survivorship:ingest [--dry-run]
 *
 * WHY: the backtest replays TODAY's universe into the past, so names that were
 * tradeable in 2021–24 but have since delisted silently vanish — survivorship
 * bias that flatters results (L5). Their prices are not in Angel One's current
 * scrip master, but the NSE full bhavcopy carries them on every day they traded.
 *
 * These are the UNAMBIGUOUS survivorship victims — names the bhavcopy shows
 * genuinely stopped trading (insolvency / delisting / merger-out), each with a
 * real end date. They are ingested as EQ instruments with candles, so
 * `loadCandleStore` (which selects EQ instruments with OHLCV, not EQUITY_UNIVERSE)
 * includes them in the backtest automatically — and only within their trading
 * window, since the candles end at delisting. No `equityUniverse.ts` change, so
 * the live universe / news alias-coverage contract is untouched.
 *
 * Prices are back-adjusted for splits/bonuses from the bhavcopy's own PREV_CLOSE
 * discontinuities (`backAdjustSplits`), matching the Angel candles' adjusted
 * convention. See docs/SURVIVORSHIP.md §4.
 */

const BHAV_DIR = join(process.cwd(), '.cache', 'bhavcopy');

/** The delisted survivorship victims + their sector (RS peer group / sector cap). */
const DELISTED: { symbol: string; name: string; sector: string }[] = [
  { symbol: 'DHFL', name: 'Dewan Housing Finance Ltd.', sector: 'NBFC / Financial Services' },
  { symbol: 'RELCAPITAL', name: 'Reliance Capital Ltd.', sector: 'NBFC / Financial Services' },
  { symbol: 'PEL', name: 'Piramal Enterprises Ltd.', sector: 'NBFC / Financial Services' },
  { symbol: 'GSPL', name: 'Gujarat State Petronet Ltd.', sector: 'Oil & Gas / Energy' },
  { symbol: 'RELINFRA', name: 'Reliance Infrastructure Ltd.', sector: 'Power / Utilities' },
  { symbol: 'FRETAIL', name: 'Future Retail Ltd.', sector: 'Consumer Durables / Retail' },
  { symbol: 'FCONSUMER', name: 'Future Consumer Ltd.', sector: 'FMCG / Consumer' },
  { symbol: 'DISHTV', name: 'Dish TV India Ltd.', sector: 'Misc Large-Cap' },
  { symbol: 'TV18BRDCST', name: 'TV18 Broadcast Ltd.', sector: 'Misc Large-Cap' },
  { symbol: 'RAJESHEXPO', name: 'Rajesh Exports Ltd.', sector: 'Misc Large-Cap' },
];

const WANTED = new Set(DELISTED.map((d) => d.symbol));
const UPSERT_SLICE = 200;

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const files = readdirSync(BHAV_DIR).filter((f) => f.endsWith('.csv')).sort();
  console.log(`Scanning ${files.length} bhavcopy files for ${WANTED.size} delisted names…`);

  // Collect raw rows per symbol across the whole archive.
  const bySymbol = new Map<string, BhavOhlcvRow[]>();
  for (const f of files) {
    const { rows } = parseBhavcopyOhlcv(readFileSync(join(BHAV_DIR, f), 'utf8'), WANTED);
    for (const r of rows) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push(r);
      bySymbol.set(r.symbol, arr);
    }
  }

  let totalCandles = 0;
  for (const { symbol, name, sector } of DELISTED) {
    const raw = (bySymbol.get(symbol) ?? []).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    if (raw.length === 0) {
      console.log(`  ${symbol.padEnd(12)} — NO bhav rows, skipped`);
      continue;
    }
    const { rows: adj, events } = backAdjustSplits(raw);
    const first = adj[0]!.tradeDate;
    const last = adj[adj.length - 1]!.tradeDate;
    const splitNote = events.length ? ` · ${events.length} corp-action(s): ${events.map((e) => `${e.exDate}×${e.ratio.toFixed(2)}`).join(', ')}` : '';
    console.log(`  ${symbol.padEnd(12)} ${first}→${last}  ${String(adj.length).padStart(4)} candles${splitNote}`);
    totalCandles += adj.length;
    if (dryRun) continue;

    const id = `NSE:${symbol}`;
    await prisma.instrument.upsert({
      where: { id },
      create: {
        id, token: `SURV-${symbol}`, symbol, name,
        instrumentType: 'EQ', exchSeg: 'NSE', sector,
      },
      update: { name, sector, instrumentType: 'EQ', exchSeg: 'NSE' },
    });

    for (let i = 0; i < adj.length; i += UPSERT_SLICE) {
      const slice = adj.slice(i, i + UPSERT_SLICE);
      await Promise.all(
        slice.map((c) =>
          prisma.ohlcv.upsert({
            where: { instrumentId_tradeDate: { instrumentId: id, tradeDate: new Date(c.tradeDate) } },
            create: {
              instrumentId: id, tradeDate: new Date(c.tradeDate),
              open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
            },
            update: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume },
          }),
        ),
      );
    }
  }

  console.log(`\n${dryRun ? '[dry-run] would ingest' : 'Ingested'} ${totalCandles} candles across ${bySymbol.size} delisted names.`);
  console.log('Note: candles end at delisting, so the backtest trades them only within their live window.');
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
