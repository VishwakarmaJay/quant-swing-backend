import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { env } from '@config/env';
import { prisma } from '@services/prisma';

import { runGdeltBackfill, type BackfillStats } from '@/news';
import { buildSymbolQuery } from '@/news/gdelt';
import { EQUITY_UNIVERSE } from '@/universe/equityUniverse';

/**
 * Full-universe GDELT historical backfill (ROADMAP B3.5) — a resumable driver
 * over `runGdeltBackfill`, one symbol at a time, for every symbol in
 * `EQUITY_UNIVERSE`.
 *
 *   bun run news:backfill:universe --from 2025-01-01 --to 2025-06-30
 *   bun run news:backfill:universe --from 2025-01-01 --to 2025-06-30 --passes 8 --cooldown 300
 *
 * Why a driver instead of one big `news:backfill` run: GDELT's rate limiting
 * is sticky (live-observed 2026-07-18 — bursts put the IP in a multi-minute
 * penalty where every request 429s). A 167-symbol run WILL hit it. This
 * script therefore:
 *
 *  - processes one symbol at a time and CHECKPOINTS after each — an
 *    interrupted/killed run resumes exactly where it stopped (and the
 *    underlying backfill is idempotent anyway);
 *  - treats a symbol with any failed query as retryable, sweeping failures in
 *    additional passes with an escalating cooldown between passes;
 *  - paces politely (`GDELT_RATE_LIMIT_MS`, floored to 5s here — GDELT's own
 *    stated minimum) and pauses `--cooldown` seconds whenever a symbol hit
 *    throttling, letting the penalty window drain before continuing.
 *
 * State file (default `.cache/gdelt-universe-backfill.json`, gitignored) is
 * keyed to the exact --from/--to range; a different range refuses to reuse it
 * (pass a different --state or delete the file).
 */

type SymbolState = {
  stored: number;
  mapped: number;
  unmatched: number;
  duplicates: number;
  alreadyStored: number;
  downloaded: number;
  completedAt: string;
};

type UniverseState = {
  from: string;
  to: string;
  done: Record<string, SymbolState>;
  /** symbol → attempt count (still incomplete). */
  attempts: Record<string, number>;
};

const usage = (): never => {
  console.error(
    'Usage: bun run news:backfill:universe --from YYYY-MM-DD --to YYYY-MM-DD ' +
      '[--state <file>] [--passes N] [--cooldown seconds] [--dry-run]',
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
  let state = '.cache/gdelt-universe-backfill.json';
  let passes = 5;
  let cooldownS = 300;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--from') from = argv[++i];
    else if (arg === '--to') to = argv[++i];
    else if (arg === '--state') state = argv[++i] ?? usage();
    else if (arg === '--passes') passes = Number(argv[++i]);
    else if (arg === '--cooldown') cooldownS = Number(argv[++i]);
    else if (arg === '--dry-run') dryRun = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  if (!Number.isInteger(passes) || passes < 1) usage();
  if (!Number.isFinite(cooldownS) || cooldownS < 0) usage();

  return {
    from: parseDateArg('from', from),
    to: parseDateArg('to', to),
    statePath: state,
    passes,
    cooldownMs: cooldownS * 1_000,
    dryRun,
  };
};

const loadState = (path: string, from: string, to: string): UniverseState => {
  if (!existsSync(path)) return { from, to, done: {}, attempts: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as UniverseState;
  if (parsed.from !== from || parsed.to !== to) {
    console.error(
      `State file ${path} is for range ${parsed.from}..${parsed.to}, not ${from}..${to}.\n` +
        `Use --state <other file> for a new range, or delete it to start over.`,
    );
    process.exit(1);
  }
  return { ...parsed, done: parsed.done ?? {}, attempts: parsed.attempts ?? {} };
};

const saveState = (path: string, state: UniverseState): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fmtStats = (s: Pick<BackfillStats, 'downloaded' | 'duplicates' | 'alreadyStored' | 'stored' | 'mapped' | 'unmatched'>) =>
  `downloaded ${s.downloaded} · dupes ${s.duplicates} · already ${s.alreadyStored} · ` +
  `stored ${s.stored} · mapped ${s.mapped} · unmatched ${s.unmatched}`;

const run = async () => {
  const { from, to, statePath, passes, cooldownMs, dryRun } = parseArgs(process.argv.slice(2));

  // GDELT's own stated pacing floor; anything faster just burns the penalty window.
  const interSymbolDelayMs = Math.max(env.GDELT_RATE_LIMIT_MS, 5_000);

  const queryable = EQUITY_UNIVERSE.filter((e) => buildSymbolQuery(e.symbol) !== null).map((e) => e.symbol);
  const noAliases = EQUITY_UNIVERSE.filter((e) => buildSymbolQuery(e.symbol) === null).map((e) => e.symbol);

  const state = loadState(statePath, from.iso, to.iso);
  const alreadyDone = queryable.filter((s) => state.done[s]).length;

  console.log(
    `\nGDELT universe backfill ${from.iso} → ${to.iso}` +
      `${dryRun ? ' · DRY RUN (no writes, no checkpointing)' : ''}\n` +
      `  ${queryable.length} queryable symbols (${alreadyDone} already checkpointed done` +
      `${noAliases.length ? `; no aliases: ${noAliases.join(', ')}` : ''})\n` +
      `  state: ${statePath} · pacing ${interSymbolDelayMs / 1000}s between symbols · ` +
      `cooldown ${cooldownMs / 1000}s after a throttled symbol · up to ${passes} pass(es)\n`,
  );

  const totals = { downloaded: 0, duplicates: 0, alreadyStored: 0, stored: 0, mapped: 0, unmatched: 0 };
  let firstRequest = true;

  for (let pass = 1; pass <= passes; pass++) {
    const pending = queryable.filter((s) => !state.done[s]);
    if (pending.length === 0) break;
    console.log(`── pass ${pass}/${passes} — ${pending.length} symbol(s) pending ──`);

    let failedThisPass = 0;
    for (const [i, symbol] of pending.entries()) {
      if (!firstRequest) await sleep(interSymbolDelayMs);
      firstRequest = false;

      let line = '';
      try {
        const summary = await runGdeltBackfill({
          from: from.date,
          to: to.date,
          symbols: [symbol],
          dryRun,
          onProgress: () => {}, // per-window lines are too chatty at universe scale
        });
        const s = summary.stats;
        line = fmtStats(s);

        if (s.failedQueries === 0) {
          totals.downloaded += s.downloaded;
          totals.duplicates += s.duplicates;
          totals.alreadyStored += s.alreadyStored;
          totals.stored += s.stored;
          totals.mapped += s.mapped;
          totals.unmatched += s.unmatched;
          if (!dryRun) {
            state.done[symbol] = {
              stored: s.stored,
              mapped: s.mapped,
              unmatched: s.unmatched,
              duplicates: s.duplicates,
              alreadyStored: s.alreadyStored,
              downloaded: s.downloaded,
              completedAt: new Date().toISOString(),
            };
            delete state.attempts[symbol];
            saveState(statePath, state);
          }
          console.log(`  [${pass}.${i + 1}/${pending.length}] ✓ ${symbol} — ${line}`);
          continue;
        }

        // Partial windows landed (idempotent), but the symbol isn't complete.
        line += ` · ${s.failedQueries} failed window(s)`;
      } catch (err) {
        line = err instanceof Error ? err.message : String(err);
      }

      failedThisPass++;
      if (!dryRun) {
        state.attempts[symbol] = (state.attempts[symbol] ?? 0) + 1;
        saveState(statePath, state);
      }
      console.log(`  [${pass}.${i + 1}/${pending.length}] ✗ ${symbol} — ${line} → retry next pass`);
      if (cooldownMs > 0) {
        console.log(`      throttle cooldown ${cooldownMs / 1000}s…`);
        await sleep(cooldownMs);
      }
    }

    if (failedThisPass > 0 && pass < passes) {
      // Escalate between passes: the penalty window is sticky; give it room.
      const passCooldown = cooldownMs * pass;
      console.log(`── pass ${pass} left ${failedThisPass} symbol(s) incomplete — waiting ${passCooldown / 1000}s ──`);
      await sleep(passCooldown);
    }
  }

  const remaining = queryable.filter((s) => !state.done[s]);
  console.log(`\nGDELT universe backfill ${dryRun ? '(dry run) ' : ''}finished:`);
  console.log(`  symbols complete    ${queryable.length - remaining.length}/${queryable.length}`);
  console.log(`  this run: ${fmtStats(totals)}`);
  if (remaining.length) {
    console.log(`  ⚠️ incomplete (re-run the same command to resume): ${remaining.join(', ')}`);
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
