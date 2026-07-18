import { backfillFundamentals } from '@/fundamentals';
import { fetchFeed } from '@/news';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';
import { prisma } from '@services/prisma';

/**
 * Completes the B4 fundamentals backfill (ROADMAP B4 tail). Self-contained and
 * re-runnable: it derives the still-missing symbols from the DB (no hardcoded
 * list), waits until Screener actually serves HTTP 200 again (connection-level
 * probe — a 429/block keeps waiting), then backfills just those symbols at the
 * configured pacing. Loops until every universe symbol has quarters or the
 * attempt budget is spent. Idempotent — safe to Ctrl-C and re-run any time.
 *
 *   bun run fundamentals:retry                 # poll every 10 min, up to 8 attempts
 *   bun run fundamentals:retry 5 12            # poll every 5 min, up to 12 attempts
 *
 * ⚠️ Run this in its own terminal; don't run other Screener-hitting commands
 * (fundamentals:backfill/snapshot) at the same time — parallel traffic is what
 * keeps the IP block alive.
 */

const PROBE_URL = 'https://www.screener.in/company/RELIANCE/consolidated/';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Universe symbols with no stored quarters yet. */
const missingSymbols = async (): Promise<string[]> => {
  const have = await prisma.quarterlyFundamental.groupBy({ by: ['symbol'] });
  const covered = new Set(have.map((g) => g.symbol));
  return EQUITY_UNIVERSE.map((e) => e.symbol).filter((s) => !covered.has(s));
};

const run = async () => {
  const pollMinutes = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 10;
  const maxAttempts = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const missing = await missingSymbols();
    if (missing.length === 0) {
      console.log(`\n✅ Coverage complete: all ${EQUITY_UNIVERSE.length} universe symbols have quarters. B4 backfill done.`);
      return;
    }
    console.log(`\nAttempt ${attempt}/${maxAttempts} — ${missing.length} symbols still missing.`);

    // Gate on a REAL 200 (fetchFeed returns null for any non-OK / blocked connection).
    process.stdout.write(`Probing Screener every ${pollMinutes} min until it serves 200 `);
    while ((await fetchFeed(PROBE_URL)) === null) {
      process.stdout.write('.');
      await sleep(pollMinutes * 60_000);
    }
    console.log(' — reachable.');

    const s = await backfillFundamentals(missing);
    console.log(
      `  Backfilled ${s.quartersUpserted} quarters across ${s.pagesOk}/${missing.length} symbols ` +
        `(${s.withAnnouncedAt} announcement-dated, ${s.fallbackDated} fallback-dated).`,
    );
    if (s.failedSymbols.length) {
      console.log(`  Still failing (${s.failedSymbols.length}): ${s.failedSymbols.join(', ')}`);
      // The circuit breaker likely tripped mid-run — cool down before the next attempt.
      if (attempt < maxAttempts) {
        console.log(`  Cooling down ${pollMinutes} min before next attempt…`);
        await sleep(pollMinutes * 60_000);
      }
    }
  }

  const remaining = await missingSymbols();
  if (remaining.length === 0) {
    console.log(`\n✅ Coverage complete: all ${EQUITY_UNIVERSE.length} universe symbols have quarters. B4 backfill done.`);
  } else {
    console.log(
      `\n⚠️ Attempt budget spent with ${remaining.length} symbols still missing: ${remaining.join(', ')}` +
        `\n   Re-run \`bun run fundamentals:retry\` later — it resumes exactly where it left off.` +
        `\n   (Symbols that persistently fail may lack a Screener page/quarters — check one manually.)`,
    );
    process.exitCode = 1;
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
