import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { r, writeCsv } from './report';

describe('writeCsv', () => {
  const path = join(tmpdir(), `research_report_${process.pid}.csv`);

  test('writes header + rows and quotes only when needed', () => {
    writeCsv(path, ['a', 'b', 'c'], [
      [1, 'x', 2.5],
      ['has,comma', 'has"quote', 3],
    ]);
    const out = readFileSync(path, 'utf8');
    expect(out).toBe('a,b,c\n1,x,2.5\n"has,comma","has""quote",3\n');
    rmSync(path, { force: true });
  });
});

describe('r — stable rounding', () => {
  test('rounds finite numbers and blanks non-finite', () => {
    expect(r(0.123456789, 4)).toBe(0.1235);
    expect(r(1 / 3)).toBe(0.333333);
    expect(r(NaN)).toBe('');
    expect(r(Infinity)).toBe('');
  });
});
