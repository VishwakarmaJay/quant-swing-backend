import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { prisma } from '@services/prisma';

import {
  backfillBseSymbol,
  loadBseBackfillContext,
  loadScripCodes,
  type BseSymbolStats,
} from '@/news/bse';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';

/**
 * BSE announcements historical backfill (ROADMAP B3.6) — see docs/BSE_BACKFILL.md.
 *
 *   bun run news:backfill:bse --from 2024-01-01 --to 2026-07-17
 *   bun run news:backfill:bse --from 2024-01-01 --to 2026-07-17 --symbols RELIANCE,TCS
 *
 * Per-scrip wide-range queries (the single-day limit is universe-wide only),
 * exchange DissemDT timestamps, origin=BSE_BACKFILL. Checkpointed per symbol
 * (default state file `.cache/bse-backfill.json`) — re-run the same command to
 * resume after any interruption; the backfill is idempotent regardless.
 */

type UniverseState = {
  from: string;
  to: string;
  done: Record<string, BseSymbolStats & { completedAt: string }>;
};

const usage = (): never => {
  console.error(
    'Usage: bun run news:backfill:bse --from YYYY-MM-DD --to YYYY-MM-DD ' +
      '[--symbols A,B] [--state <file>] [--passes N] [--dry-run]',
  );
  process.exit(1);
};

const parseDateArg = (name: string, value: string | undefined): { date: Date; iso: string } => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`--${name} must be YYYY-MM-DD (got: ${value ?? 'nothing'})`);
    return usage();
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    console.error(`--${name}: ${value} is not a real calendar date`);
    return usage();
  }
  return { date, iso: value };
};

const parseArgs = (argv: string[]) => {
  let from: string | undefined;
  let to: string | undefined;
  let symbols: string[] | undefined;
  let state = '.cache/bse-backfill.json';
  let passes = 3;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--from') from = argv[++i];
    else if (arg === '--to') to = argv[++i];
    else if (arg === '--symbols') {
      symbols = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!symbols.length) usage();
    } else if (arg === '--state') state = argv[++i] ?? usage();
    else if (arg === '--passes') passes = Number(argv[++i]);
    else if (arg === '--dry-run') dryRun = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  if (!Number.isInteger(passes) || passes < 1) usage();
  return { from: parseDateArg('from', from), to: parseDateArg('to', to), symbols, statePath: state, passes, dryRun };
};

const loadState = (path: string, from: string, to: string): UniverseState => {
  if (!existsSync(path)) return { from, to, done: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as UniverseState;
  if (parsed.from !== from || parsed.to !== to) {
    console.error(`State file ${path} is for ${parsed.from}..${parsed.to}, not ${from}..${to} — use another --state or delete it.`);
    process.exit(1);
  }
  return { ...parsed, done: parsed.done ?? {} };
};

const saveState = (path: string, state: UniverseState): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
};

const run = async () => {
  const { from, to, symbols, statePath, passes, dryRun } = parseArgs(process.argv.slice(2));

  const scripCodes = await loadScripCodes();
  const universe = EQUITY_UNIVERSE.map((e) => e.symbol);
  const requested = symbols ?? universe;
  const unknown = requested.filter((s) => !universe.includes(s));
  if (unknown.length) {
    console.error(`Unknown universe symbol(s): ${unknown.join(', ')}`);
    process.exit(1);
  }
  const queryable = requested.filter((s) => scripCodes[s]);
  const noScrip = requested.filter((s) => !scripCodes[s]);

  const state = loadState(statePath, from.iso, to.iso);
  const alreadyDone = queryable.filter((s) => state.done[s]).length;

  console.log(
    `\nBSE announcements backfill ${from.iso} → ${to.iso}${dryRun ? ' · DRY RUN' : ''}\n` +
      `  ${queryable.length} symbols with scrip codes (${alreadyDone} already checkpointed done` +
      `${noScrip.length ? `; no scrip code: ${noScrip.join(', ')}` : ''})\n` +
      `  state: ${statePath}\n`,
  );

  const { corpus, existingKeys } = await loadBseBackfillContext(from.date, to.date);
  const importedAt = new Date();
  const totals = { downloaded: 0, duplicates: 0, alreadyStored: 0, stored: 0, mapped: 0, unmatched: 0 };

  for (let pass = 1; pass <= passes; pass++) {
    const pending = queryable.filter((s) => !state.done[s]);
    if (pending.length === 0) break;
    console.log(`── pass ${pass}/${passes} — ${pending.length} symbol(s) pending ──`);

    for (const [i, symbol] of pending.entries()) {
      const stats = await backfillBseSymbol({
        symbol,
        scripCode: scripCodes[symbol]!,
        from: from.date,
        to: to.date,
        dryRun,
        importedAt,
        corpus,
        existingKeys,
      });
      const line =
        `downloaded ${stats.downloaded} · dupes ${stats.duplicates} · already ${stats.alreadyStored} · ` +
        `stored ${stats.stored} · mapped ${stats.mapped} · unmatched ${stats.unmatched}`;

      if (stats.failedWindows === 0) {
        totals.downloaded += stats.downloaded;
        totals.duplicates += stats.duplicates;
        totals.alreadyStored += stats.alreadyStored;
        totals.stored += stats.stored;
        totals.mapped += stats.mapped;
        totals.unmatched += stats.unmatched;
        // Mark done in-memory either way (a dry-run must not re-loop passes);
        // only persist the checkpoint on a real run.
        state.done[symbol] = { ...stats, completedAt: new Date().toISOString() };
        if (!dryRun) saveState(statePath, state);
        console.log(`  [${pass}.${i + 1}/${pending.length}] ✓ ${symbol} — ${line}`);
      } else {
        console.log(`  [${pass}.${i + 1}/${pending.length}] ✗ ${symbol} — ${line} · ${stats.failedWindows} failed window(s) → retry next pass`);
      }
    }
  }

  const remaining = queryable.filter((s) => !state.done[s]);
  console.log(`\nBSE backfill ${dryRun ? '(dry run) ' : ''}finished:`);
  console.log(`  symbols complete    ${queryable.length - remaining.length}/${queryable.length}`);
  console.log(`  this run: downloaded ${totals.downloaded} · dupes ${totals.duplicates} · already ${totals.alreadyStored} · stored ${totals.stored} · mapped ${totals.mapped} · unmatched ${totals.unmatched}`);
  if (remaining.length) {
    console.log(`  ⚠️ incomplete (re-run to resume): ${remaining.join(', ')}`);
    process.exitCode = 1;
  } else if (!dryRun) {
    console.log(`  Note: new rows are unscored — the next ingest cron pass (or \`bun run sentiment:score\`) scores them.`);
  }
};

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
