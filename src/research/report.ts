import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * CSV emission for the research layer (Task 4/5). Deliberately tiny — no CSV
 * dependency, deterministic output, RFC-4180 quoting only where needed.
 *
 * WHY THIS FILE EXISTS (Task 3 duplication justification): the existing studies
 * print to the console; the evidence request wants machine-readable CSVs in
 * research-output/. No analytical logic here — formatting only.
 */

/** Quote a field iff it contains a comma, quote, or newline (RFC-4180). */
const csvField = (v: string | number): string => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Writes `header` + `rows` as CSV to `path`, creating parent dirs. */
export const writeCsv = (path: string, header: readonly string[], rows: readonly (readonly (string | number)[])[]): void => {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
};

/** Round to `dp` decimals for stable CSV output; passes through non-finite as ''. */
export const r = (v: number, dp = 6): number | string => (Number.isFinite(v) ? Number(v.toFixed(dp)) : '');
