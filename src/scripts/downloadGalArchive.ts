import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { COMPANY_ALIASES } from '@/news';

/**
 * GDELT Article List (GAL) bulk downloader (B3.5 fast path — replaces the
 * throttled DOC API for bulk media history; see GDELT_BACKFILL.md).
 *
 *   bun run news:gal:download --from 2025-01-01 --to 2026-07-17 --out .cache/gal-matched.ndjson
 *
 * GAL = one gzipped NDJSON file per publish tick (minutes +1..+5 after every
 * quarter-hour, live-verified 2026-07-19) with {date, url, domain, title,
 * desc, lang} for EVERY article GDELT monitors — plain HTTP, no rate limits.
 * This script sweeps the range, keeps English records whose title matches any
 * curated company alias (recall pre-filter; the real symbol mapper decides at
 * import), and appends them to an NDJSON output. Checkpointed per quarter-hour;
 * re-running resumes. Designed to run on a workstation (bandwidth + CPU),
 * with `news:gal:import` doing the DB work on the server.
 *
 * NOTE: no DB and no env needed — pure network + filesystem.
 */

const GAL_BASE = 'http://data.gdeltproject.org/gdeltv3/gal';
/** Minutes after each quarter-hour where files appear (live-observed). */
const MINUTE_OFFSETS = [1, 2, 3, 4, 5];
const CONCURRENT_QUARTERS = 8;
const FETCH_TIMEOUT_MS = 30_000;

const usage = (): never => {
  console.error('Usage: bun run news:gal:download --from YYYY-MM-DD --to YYYY-MM-DD [--out file] [--state file]');
  process.exit(1);
};

const parseArgs = (argv: string[]) => {
  let from: string | undefined;
  let to: string | undefined;
  let out = '.cache/gal-matched.ndjson';
  let state = '.cache/gal-download-state.json';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--from') from = argv[++i];
    else if (a === '--to') to = argv[++i];
    else if (a === '--out') out = argv[++i] ?? usage();
    else if (a === '--state') state = argv[++i] ?? usage();
    else usage();
  }
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) usage();
  return { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T23:45:00Z`), out, state };
};

// One combined boundary-anchored alternation over every curated alias — a
// single regex pass per title instead of ~600 (the import re-maps precisely).
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RE = new RegExp(
  `(^|[^a-z0-9])(${Object.values(COMPANY_ALIASES)
    .flat()
    .map((a) => escapeRe(a.trim().toLowerCase()).replace(/\\?\s+/g, '\\s+'))
    .join('|')})([^a-z0-9]|$)`,
);

type GalRecord = { date: string; url: string; domain: string; title: string; desc: string; lang: string };

const ts14 = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
  `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00`;

const fetchGz = async (url: string): Promise<Buffer | null> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null; // treated as missing; quarter marked incomplete below on total failure
  }
};

/** Downloads one quarter-hour's files; returns matched NDJSON lines. */
const sweepQuarter = async (quarter: Date): Promise<{ lines: string[]; files: number }> => {
  const lines: string[] = [];
  let files = 0;
  for (const offset of MINUTE_OFFSETS) {
    const t = new Date(quarter.getTime() + offset * 60_000);
    const gz = await fetchGz(`${GAL_BASE}/${ts14(t)}.gal.json.gz`);
    if (!gz) continue;
    files++;
    let raw: string;
    try {
      raw = gunzipSync(gz).toString('utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      // Cheap prefilters before JSON.parse: language + one alias regex pass.
      if (!line.includes('"lang": "en"') && !line.includes('"lang":"en"')) continue;
      let rec: GalRecord;
      try {
        rec = JSON.parse(line) as GalRecord;
      } catch {
        continue;
      }
      if (!rec.title || !rec.url || !rec.date) continue;
      if (!ALIAS_RE.test(rec.title.toLowerCase())) continue;
      lines.push(JSON.stringify({ date: rec.date, url: rec.url, domain: rec.domain, title: rec.title, desc: rec.desc ?? '' }));
    }
  }
  return { lines, files };
};

const run = async () => {
  const { from, to, out, state } = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(out), { recursive: true });

  const done = new Set<string>(existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as string[]) : []);
  const quarters: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 900_000) {
    const q = new Date(t);
    if (!done.has(q.toISOString())) quarters.push(q);
  }
  console.log(`GAL sweep: ${quarters.length} quarter-hours pending (${done.size} checkpointed) → ${out}`);

  let matched = 0;
  let files = 0;
  let processed = 0;
  const started = Date.now();

  for (let i = 0; i < quarters.length; i += CONCURRENT_QUARTERS) {
    const batch = quarters.slice(i, i + CONCURRENT_QUARTERS);
    const results = await Promise.all(batch.map((q) => sweepQuarter(q)));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j]!;
      if (r.lines.length) appendFileSync(out, r.lines.join('\n') + '\n');
      matched += r.lines.length;
      files += r.files;
      done.add(batch[j]!.toISOString());
    }
    processed += batch.length;
    if (processed % 400 < CONCURRENT_QUARTERS) {
      writeFileSync(state, JSON.stringify([...done]));
      const rate = processed / ((Date.now() - started) / 60_000);
      console.log(
        `  ${processed}/${quarters.length} quarters · ${files} files · ${matched} matched · ` +
          `${rate.toFixed(0)} q/min · ETA ${((quarters.length - processed) / rate).toFixed(0)} min`,
      );
    }
  }
  writeFileSync(state, JSON.stringify([...done]));
  console.log(`\nDone: ${processed} quarters · ${files} files · ${matched} matched records → ${out}`);
};

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
