import { describe, expect, test } from 'bun:test';

import { NewsOrigin } from '@generated/prisma/enums';

import { normalizeTitle } from '../dedupe';
import { GDELT_SOURCE, processGdeltRecords } from './backfill';
import type { GdeltRecord } from './parser';

const record = (over: Partial<GdeltRecord> & { url: string; title: string }): GdeltRecord => ({
  publishedAt: new Date('2025-06-13T16:00:00Z'),
  availableAt: new Date('2025-06-13T16:30:00Z'),
  domain: 'x.test',
  ...over,
});

const IMPORTED_AT = new Date('2026-07-18T09:00:00Z');

describe('processGdeltRecords — row construction', () => {
  test('stamps provenance and honest timestamps', () => {
    const result = processGdeltRecords(
      [record({ url: 'https://x.test/ril', title: 'Reliance Industries posts record quarterly profit' })],
      IMPORTED_AT,
      [],
      new Set(),
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.source).toBe(GDELT_SOURCE);
    expect(row.origin).toBe(NewsOrigin.GDELT);
    expect(row.publishedAt.toISOString()).toBe('2025-06-13T16:00:00.000Z');
    expect(row.availableAt.toISOString()).toBe('2025-06-13T16:30:00.000Z'); // published + 30 min
    expect(row.fetchedAt).toBe(IMPORTED_AT); // import time ≠ as-of time
    expect(row.body).toBeNull();
    expect(row.titleNormalized).toBe(normalizeTitle(row.title));
  });
});

describe('processGdeltRecords — symbol mapping integration (real mapper + aliases)', () => {
  test('maps curated aliases to canonical symbols', () => {
    const result = processGdeltRecords(
      [
        record({ url: 'https://x.test/1', title: 'Reliance Industries posts record quarterly profit' }),
        record({ url: 'https://x.test/2', title: 'HDFC Bank and ICICI Bank rally on rate cut hopes' }),
        record({ url: 'https://x.test/3', title: 'Monsoon arrives early across the country' }),
      ],
      IMPORTED_AT,
      [],
      new Set(),
    );
    expect(result.rows[0]!.symbols).toEqual(['RELIANCE']);
    expect(result.rows[1]!.symbols).toEqual(expect.arrayContaining(['HDFCBANK', 'ICICIBANK']));
    expect(result.rows[2]!.symbols).toEqual([]);
    expect(result.mapped).toBe(2);
    expect(result.unmatched).toBe(1);
    expect(result.unmatchedSample).toEqual(['Monsoon arrives early across the country']);
  });

  test('mapper precision rules apply unchanged (SBI-subsidiary exclusion)', () => {
    const result = processGdeltRecords(
      [record({ url: 'https://x.test/sbilife', title: 'SBI Life reports strong premium growth' })],
      IMPORTED_AT,
      [],
      new Set(),
    );
    // "sbi" must NOT fire on "SBI Life" (SBILIFE is its own universe stock).
    expect(result.rows[0]!.symbols).toEqual(['SBILIFE']);
  });
});

describe('processGdeltRecords — duplicate handling', () => {
  test('near-duplicate titles vs the corpus are skipped (Jaccard, shared code)', () => {
    const corpus = [
      { titleNormalized: normalizeTitle('Reliance Industries posts record quarterly profit for Q1'), publishedAtMs: new Date('2025-06-13T10:00:00Z').getTime() },
    ];
    const result = processGdeltRecords(
      [record({ url: 'https://x.test/dupe', title: 'Reliance Industries posts record quarterly profit in Q1' })],
      IMPORTED_AT,
      corpus,
      new Set(),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  test('dedupes within a run: second syndicated copy is dropped', () => {
    const result = processGdeltRecords(
      [
        record({ url: 'https://a.test/story', title: 'Tata Motors launches new EV platform in partnership' }),
        record({ url: 'https://b.test/story', title: 'Tata Motors launches new EV platform in a partnership' }),
      ],
      IMPORTED_AT,
      [],
      new Set(),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  test('different stories about the same company both survive', () => {
    const result = processGdeltRecords(
      [
        record({ url: 'https://x.test/a', title: 'Infosys wins large European banking deal worth billions' }),
        record({ url: 'https://x.test/b', title: 'Infosys announces leadership change in cloud division' }),
      ],
      IMPORTED_AT,
      [],
      new Set(),
    );
    expect(result.rows).toHaveLength(2);
  });
});

describe('processGdeltRecords — idempotency', () => {
  const records = [
    record({ url: 'https://x.test/1', title: 'Reliance Industries posts record quarterly profit' }),
    record({ url: 'https://x.test/2', title: 'HDFC Bank and ICICI Bank rally on rate cut hopes' }),
  ];

  test('re-processing the same records with the post-run state creates zero rows', () => {
    const corpus: { titleNormalized: string; publishedAtMs: number }[] = [];
    const existingUrls = new Set<string>();

    const first = processGdeltRecords(records, IMPORTED_AT, corpus, existingUrls);
    expect(first.rows).toHaveLength(2);

    // Second run: state now contains the stored URLs/titles (as a re-run
    // would load them from the DB).
    const second = processGdeltRecords(records, IMPORTED_AT, corpus, existingUrls);
    expect(second.rows).toHaveLength(0);
    expect(second.alreadyStored).toBe(2);
    expect(second.duplicates).toBe(0); // identity beats similarity: counted as stored, not dupes
  });

  test('URL identity check precedes Jaccard (stable-identifier idempotency)', () => {
    const existingUrls = new Set(['https://x.test/1']);
    const result = processGdeltRecords([records[0]!], IMPORTED_AT, [], existingUrls);
    expect(result.alreadyStored).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});
