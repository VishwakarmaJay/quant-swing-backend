import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bhavcopyUrl, parseBhavcopy } from '@/delivery/bhavcopy';

/**
 * B13 — NSE bhavcopy (delivery %) downloader. Network + filesystem only; no DB,
 * no business logic.
 *
 *   bun run bhavcopy:download --from 2024-01-01 --to 2026-07-17 [--dir .cache/bhavcopy]
 *
 * Files are cached one-per-day on disk and skipped if already present, so the
 * run is **idempotent and resumable** — kill it and re-run the same command.
 * Weekends are skipped without a request; holidays simply 404 and are recorded
 * as absent so a re-run does not re-probe them.
 *
 * Politeness: NSE is WAF-guarded and this is an unofficial-contract endpoint —
 * browser UA + Referer (live-verified), and a pacing delay between requests. The
 * Screener lesson applies: sustained fast scraping gets the IP blocked, and the
 * archive is worth more than the hour saved.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const RATE_LIMIT_MS = Number(process.env.BHAVCOPY_RATE_LIMIT_MS ?? 900);
const TIMEOUT_MS = 25_000;

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v == null && fallback == null) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return v ?? fallback!;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every calendar date in [from, to], weekends excluded (NSE never trades them). */
const tradingCalendarDates = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

const run = async () => {
  const from = arg('from');
  const to = arg('to');
  const dir = arg('dir', '.cache/bhavcopy');
  mkdirSync(dir, { recursive: true });

  // Records dates known to have no file (holidays), so re-runs don't re-probe.
  const absentPath = join(dir, '_absent.json');
  const absent = new Set<string>(existsSync(absentPath) ? JSON.parse(readFileSync(absentPath, 'utf8')) : []);

  const dates = tradingCalendarDates(from, to);
  console.log(`Bhavcopy download ${from} → ${to}: ${dates.length} weekdays · cache ${dir} · pacing ${RATE_LIMIT_MS}ms`);

  let cached = 0;
  let fetched = 0;
  let holiday = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const date of dates) {
    const file = join(dir, `${date}.csv`);
    if (existsSync(file)) {
      cached++;
      continue;
    }
    if (absent.has(date)) {
      holiday++;
      continue;
    }

    try {
      const res = await fetch(bhavcopyUrl(date), {
        headers: { 'User-Agent': UA, Referer: 'https://www.nseindia.com/', Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) {
        absent.add(date); // market holiday — remember it
        holiday++;
      } else if (!res.ok) {
        failed++;
        failures.push(`${date} (HTTP ${res.status})`);
      } else {
        const text = await res.text();
        // Validate before caching: a WAF challenge page returns 200 with HTML,
        // which would poison the cache as a silently empty "trading day".
        const { rows } = parseBhavcopy(text);
        if (rows.length < 100) {
          failed++;
          failures.push(`${date} (only ${rows.length} EQ rows — WAF page or truncated?)`);
        } else {
          writeFileSync(file, text);
          fetched++;
        }
      }
    } catch (err) {
      failed++;
      failures.push(`${date} (${(err as Error).message})`);
    }
    await sleep(RATE_LIMIT_MS);

    const done = cached + fetched + holiday + failed;
    if (done % 50 === 0) console.log(`  …${done}/${dates.length} (fetched ${fetched}, cached ${cached}, holidays ${holiday}, failed ${failed})`);
  }

  writeFileSync(absentPath, JSON.stringify([...absent].sort(), null, 0));

  console.log(
    `\nDone: fetched ${fetched} · already cached ${cached} · holidays/absent ${holiday} · failed ${failed}`,
  );
  if (failures.length) {
    console.log(`  Failures (re-run the same command to retry — it is idempotent):`);
    for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
    if (failures.length > 20) console.log(`    …and ${failures.length - 20} more`);
    process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
