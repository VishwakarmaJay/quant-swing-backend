import { runGdeltBackfill } from '@/news';
import { prisma } from '@services/prisma';

/**
 * Historical news backfill from GDELT (ROADMAP B3.5) — see docs/GDELT_BACKFILL.md.
 *
 *   bun run news:backfill --from 2025-01-01 --to 2025-06-30
 *   bun run news:backfill --from 2025-01-01 --to 2025-06-30 --symbols RELIANCE,TCS,INFY
 *   bun run news:backfill --from 2025-01-01 --to 2025-01-31 --dry-run
 *
 * Idempotent (re-running stores zero duplicates) and point-in-time honest:
 * each imported row carries origin=GDELT and availableAt = publishedAt +
 * GDELT_LATENCY_MINUTES. Needs network (GDELT DOC API) + a reachable database.
 */

const usage = (): never => {
  console.error(
    'Usage: bun run news:backfill --from YYYY-MM-DD --to YYYY-MM-DD [--symbols RELIANCE,TCS,...] [--dry-run]',
  );
  process.exit(1);
};

const parseDateArg = (name: string, value: string | undefined): Date => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`--${name} must be YYYY-MM-DD (got: ${value ?? 'nothing'})`);
    return usage();
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    console.error(`--${name}: ${value} is not a real calendar date`);
    return usage();
  }
  return date;
};

const parseArgs = (argv: string[]) => {
  let from: string | undefined;
  let to: string | undefined;
  let symbols: string[] | undefined;
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
    } else if (arg === '--dry-run') dryRun = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  return { from: parseDateArg('from', from), to: parseDateArg('to', to), symbols, dryRun };
};

const run = async () => {
  const { from, to, symbols, dryRun } = parseArgs(process.argv.slice(2));

  const summary = await runGdeltBackfill({
    from,
    to,
    symbols,
    dryRun,
    onProgress: (line) => console.log(`  ${line}`),
  });

  const s = summary.stats;
  console.log(`\nGDELT backfill ${dryRun ? '(dry run) ' : ''}complete:\n`);
  console.log(`  days processed     ${s.daysProcessed}`);
  console.log(`  articles downloaded ${s.downloaded}`);
  console.log(`  duplicates          ${s.duplicates} (near-dup titles) + ${s.alreadyStored} already stored`);
  console.log(`  stored              ${s.stored}`);
  console.log(`  mapped              ${s.mapped}`);
  console.log(`  unmatched           ${s.unmatched}`);
  if (s.truncatedQueries) {
    console.log(`  ⚠️ ${s.truncatedQueries} quer${s.truncatedQueries === 1 ? 'y' : 'ies'} hit the 250-record cap — lower GDELT_BATCH_DAYS for denser coverage`);
  }
  if (s.failedQueries) {
    console.log(`  ⚠️ ${s.failedQueries} quer${s.failedQueries === 1 ? 'y' : 'ies'} failed — re-run the same range (idempotent) to fill gaps`);
  }
  if (summary.symbolsWithoutAliases.length) {
    console.log(`  ⚠️ no aliases (not queried): ${summary.symbolsWithoutAliases.join(', ')}`);
  }
  if (summary.unmatchedSample.length) {
    console.log(`\n  Unmatched headlines (grow the alias dictionary):`);
    for (const h of summary.unmatchedSample) console.log(`    · ${h}`);
  }
  if (!dryRun && s.stored > 0) {
    console.log(`\n  Note: new rows are unscored — the next ingest cron pass (or \`bun run sentiment:score\`) scores them.`);
  }
};

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
