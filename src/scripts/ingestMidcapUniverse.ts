import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { backAdjustSplits, parseBhavcopyOhlcv, type BhavOhlcvRow } from '@/ohlcv/bhavcopyOhlcv';
import { normalizeMidcapSector } from '@/universe/midcapSectors';
import { prisma } from '@services/prisma';

/**
 * Option-B spike — ingest a point-in-time Nifty Midcap 150 universe from the B13
 * bhavcopy archive (docs/MIDCAP_SPIKE.md). Idempotent (upsert).
 *
 *   bun run midcap:ingest [--dry-run]
 *
 * DESIGN (survivorship-correct, look-ahead-free):
 *  - Universe = the **2021-03 Midcap 150 cohort** (a fixed point-in-time set), read
 *    from the committed constituent snapshots in `data/midcap/`. A fixed cohort
 *    sidesteps entry-timing look-ahead: names only *exit* (delist / leave the index),
 *    never enter mid-window, so trading from 2021 is never "knowing" a later promotion.
 *  - Each name's candles are bounded to `[2021, exit]`, where `exit` is bracketed by
 *    the later snapshots (2022-03 / 2023-08 / current). The candle range itself enforces
 *    the exit — the same "candles bound tradeability" mechanism the survivorship repair
 *    used — so no separate membership map is needed. Exit is precise only to ±1
 *    reconstitution (annual snapshots).
 *  - Instruments are `instrumentType: 'EQ_MID'`, id `MID:<symbol>`, so `loadCandleStore`
 *    (which queries `EQ`) ignores them unless asked (universeType) — every existing
 *    large-cap backtest stays untouched.
 *  - Raw deduped bhavcopy prices (no split heuristic — see SURVIVORSHIP.md §4 for why).
 */

const DATA_DIR = join(process.cwd(), 'data', 'midcap');
const BHAV_DIR = join(process.cwd(), '.cache', 'bhavcopy');
const SNAPSHOTS: [string, string][] = [
  ['2021-03', 'nifty_midcap150_2021-03.csv'],
  ['2022-03', 'nifty_midcap150_2022-03.csv'],
  ['2023-08', 'nifty_midcap150_2023-08.csv'],
  ['current', 'nifty_midcap150_current.csv'],
];
/** Exit date for a cohort name last seen in snapshot X = ~the next reconstitution. */
const EXIT_AFTER: Record<string, string> = {
  '2021-03': '2022-04-01',
  '2022-03': '2023-09-01',
  '2023-08': '2025-01-01', // 2023-08→current gap is wide; rough midpoint
};

const readSnapshot = (file: string) =>
  readFileSync(join(DATA_DIR, file), 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(','))
    .filter((c) => c.length >= 3)
    .map((c) => ({ sym: c[2]!.trim(), sector: c[1]!.trim() }));

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');

  // Build cohort membership from the snapshots.
  const inSnap = new Map<string, Set<string>>();
  const sectorOf = new Map<string, string>();
  for (const [label, file] of SNAPSHOTS) {
    for (const { sym, sector } of readSnapshot(file)) {
      (inSnap.get(sym) ?? inSnap.set(sym, new Set()).get(sym)!).add(label);
      sectorOf.set(sym, normalizeMidcapSector(sector)); // latest snapshot wins
    }
  }
  // Cohort = present in the 2021-03 snapshot.
  const cohort = [...inSnap.entries()].filter(([, s]) => s.has('2021-03')).map(([sym]) => sym);
  const exitOf = (sym: string): string | null => {
    const s = inSnap.get(sym)!;
    if (s.has('current')) return null; // never left
    const last = ['2023-08', '2022-03', '2021-03'].find((l) => s.has(l))!;
    return EXIT_AFTER[last] ?? null;
  };
  console.log(`2021-03 Midcap 150 cohort: ${cohort.length} names`);

  // Scan bhavcopy once for the cohort.
  const wanted = new Set(cohort);
  const bySymbol = new Map<string, BhavOhlcvRow[]>();
  const files = readdirSync(BHAV_DIR).filter((f) => f.endsWith('.csv')).sort();
  for (const f of files) {
    const { rows } = parseBhavcopyOhlcv(readFileSync(join(BHAV_DIR, f), 'utf8'), wanted);
    for (const r of rows) (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(r);
  }

  let ingestedNames = 0;
  let totalCandles = 0;
  const skipped: string[] = [];
  const corpActions = new Map<string, number>();
  for (const sym of cohort.sort()) {
    const collected = bySymbol.get(sym);
    if (!collected?.length) {
      skipped.push(sym);
      continue;
    }
    // dedup by date, bound to exit
    const exit = exitOf(sym);
    const byDate = new Map<string, BhavOhlcvRow>();
    for (const r of collected) if (!exit || r.tradeDate < exit) byDate.set(r.tradeDate, r);
    const deduped = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    if (deduped.length < 60) {
      skipped.push(`${sym}(thin:${deduped.length})`);
      continue;
    }
    // Midcaps are healthy and liquid (trade daily → few gaps), so the PREV_CLOSE
    // split heuristic is reliable here (unlike the distressed survivorship names).
    // Adjusting is REQUIRED: an unadjusted 2:1 split reads as a −50% crash → false
    // thesis-break / signal. See SURVIVORSHIP.md §4 for the heuristic + its limits.
    const { rows: series, events } = backAdjustSplits(deduped);
    if (events.length) corpActions.set(sym, events.length);
    ingestedNames++;
    totalCandles += series.length;
    if (dryRun) continue;

    const id = `MID:${sym}`;
    await prisma.instrument.upsert({
      where: { id },
      create: { id, token: `MID-${sym}`, symbol: sym, name: sym, instrumentType: 'EQ_MID', exchSeg: 'NSE', sector: sectorOf.get(sym) ?? null },
      update: { instrumentType: 'EQ_MID', exchSeg: 'NSE', sector: sectorOf.get(sym) ?? null },
    });
    for (let i = 0; i < series.length; i += 200) {
      const slice = series.slice(i, i + 200);
      await Promise.all(
        slice.map((c) =>
          prisma.ohlcv.upsert({
            where: { instrumentId_tradeDate: { instrumentId: id, tradeDate: new Date(c.tradeDate) } },
            create: { instrumentId: id, tradeDate: new Date(c.tradeDate), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume },
            update: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume },
          }),
        ),
      );
    }
  }

  console.log(`${dryRun ? '[dry-run] would ingest' : 'Ingested'} ${ingestedNames} names · ${totalCandles} candles (EQ_MID).`);
  console.log(`Skipped ${skipped.length} (no/thin bhav): ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? '…' : ''}`);
  console.log(`Corp-action back-adjusted: ${corpActions.size} names (${[...corpActions.entries()].map(([s, n]) => `${s}:${n}`).slice(0, 15).join(', ')}${corpActions.size > 15 ? '…' : ''})`);
  const sectors = new Set([...cohort].map((s) => sectorOf.get(s)));
  console.log(`Sectors: ${[...sectors].sort().join(', ')}`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
