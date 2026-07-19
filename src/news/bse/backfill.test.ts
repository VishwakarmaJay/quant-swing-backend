import { describe, expect, test } from 'bun:test';

import { NewsOrigin } from '@generated/prisma/enums';

import { normalizeTitle } from '../dedupe';
import type { RawFeedItem } from '../types';
import { DatedTitleIndex } from '../dedupe';
import { bseCompanyKey, bseRowKey, processBseItems, BSE_SOURCE, type BseCorpus } from './backfill';
import { buildScripAnnouncementsUrl, parseRowcnt, downloadScripWindow } from './download';

const IMPORTED_AT = new Date('2026-07-18T12:00:00Z');

const item = (over: Partial<RawFeedItem> & { title: string }): RawFeedItem => ({
  url: 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc.pdf',
  publishedAt: '2025-03-28T20:22:19.470',
  body: 'Reliance Industries Ltd — quarterly results',
  ...over,
});

describe('processBseItems — row construction (timestamp reconstruction)', () => {
  test('availableAt = DissemDT + latency; provenance BSE_BACKFILL; source shared with live', () => {
    const result = processBseItems([item({ title: 'Results for Q4' })], IMPORTED_AT, 30, new Map(), new Set());
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.source).toBe(BSE_SOURCE);
    expect(row.origin).toBe(NewsOrigin.BSE_BACKFILL);
    expect(row.availableAt.getTime() - row.publishedAt.getTime()).toBe(30 * 60_000);
    expect(row.fetchedAt).toBe(IMPORTED_AT);
  });

  test('items without a dissemination time are skipped (no honest availableAt)', () => {
    const result = processBseItems(
      [item({ title: 'No timestamp', publishedAt: null }), item({ title: 'Bad timestamp', publishedAt: 'garbage' })],
      IMPORTED_AT,
      30,
      new Map(),
      new Set(),
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('processBseItems — symbol mapping via SLONGNAME body (live parser contract)', () => {
  test('boilerplate headline maps through the company name in the body', () => {
    const result = processBseItems(
      [item({ title: 'Intimation under Regulation 30 of SEBI LODR', body: 'Reliance Industries Ltd — disclosure' })],
      IMPORTED_AT,
      30,
      new Map(),
      new Set(),
    );
    expect(result.rows[0]!.symbols).toEqual(['RELIANCE']);
    expect(result.mapped).toBe(1);
  });
});

describe('processBseItems — idempotency and duplicate handling', () => {
  test('urn fallback key matches the live pipeline convention when url is empty', () => {
    expect(bseRowKey('', normalizeTitle('Board Meeting Intimation'))).toBe(
      `urn:${BSE_SOURCE}:board meeting intimation`,
    );
    expect(bseRowKey('https://x.test/a.pdf', 'anything')).toBe('https://x.test/a.pdf');
  });

  test('re-processing with post-run state creates zero rows (identity beats similarity)', () => {
    const corpus: BseCorpus = new Map();
    const keys = new Set<string>();
    const items = [item({ title: 'Reliance Industries allotment of NCDs tranche one' })];

    const first = processBseItems(items, IMPORTED_AT, 30, corpus, keys);
    expect(first.rows).toHaveLength(1);
    const second = processBseItems(items, IMPORTED_AT, 30, corpus, keys);
    expect(second.rows).toHaveLength(0);
    expect(second.alreadyStored).toBe(1);
    expect(second.duplicates).toBe(0);
  });

  test('near-duplicate titles within the SAME company are dropped', () => {
    const company = bseCompanyKey('Reliance Industries Ltd — quarterly results');
    const index = new DatedTitleIndex(3 * 86_400_000);
    index.add(normalizeTitle('Reliance reports record quarterly consolidated results March'), new Date('2025-03-27T10:00:00Z').getTime());
    const corpus: BseCorpus = new Map([[company, index]]);
    const result = processBseItems(
      [item({ title: 'Reliance reports record quarterly consolidated results for March', url: 'https://x.test/other.pdf' })],
      IMPORTED_AT,
      30,
      corpus,
      new Set(),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  test('the SAME templated title recurring months later is a NEW event, not a duplicate', () => {
    const corpus: BseCorpus = new Map();
    const result = processBseItems(
      [
        item({ title: 'Board Meeting Intimation', url: 'https://x.test/q4.pdf', publishedAt: '2025-01-15T10:00:00.000' }),
        item({ title: 'Board Meeting Intimation', url: 'https://x.test/q1.pdf', publishedAt: '2025-04-15T10:00:00.000' }),
        // …but the same title 1 day later IS a duplicate (re-filing/correction).
        item({ title: 'Board Meeting Intimation', url: 'https://x.test/q1b.pdf', publishedAt: '2025-04-16T10:00:00.000' }),
      ],
      IMPORTED_AT,
      30,
      corpus,
      new Set(),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  test('IDENTICAL templated titles from DIFFERENT companies both survive (the 64% loss bug)', () => {
    const corpus: BseCorpus = new Map();
    const result = processBseItems(
      [
        item({
          title: 'Financial Results for the quarter ended March 31',
          url: 'https://x.test/godrej.pdf',
          body: 'Godrej Consumer Products Ltd — results',
        }),
        item({
          title: 'Financial Results for the quarter ended March 31',
          url: 'https://x.test/hal.pdf',
          body: 'Hindustan Aeronautics Ltd — results',
        }),
      ],
      IMPORTED_AT,
      30,
      corpus,
      new Set(),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.duplicates).toBe(0);
    expect(result.rows[0]!.symbols).toEqual(['GODREJCP']);
    expect(result.rows[1]!.symbols).toEqual(['HAL']);
  });
});

describe('BSE download — URL building and ROWCNT pagination', () => {
  const from = new Date('2025-01-01T00:00:00Z');
  const to = new Date('2025-03-31T00:00:00Z');

  test('per-scrip wide-range URL matches the live-verified shape', () => {
    const url = buildScripAnnouncementsUrl('500325', from, to, 1);
    expect(url).toContain('strScrip=500325');
    expect(url).toContain('strPrevDate=20250101');
    expect(url).toContain('strToDate=20250331');
    expect(url).toContain('strCat=-1');
    expect(url).toContain('pageno=1');
  });

  test('parseRowcnt reads Table1.ROWCNT', () => {
    expect(parseRowcnt('{"Table": [], "Table1": [{"ROWCNT": 39}]}')).toBe(39);
    expect(parseRowcnt('{"Table": []}')).toBeNull();
    expect(parseRowcnt('No Record Found!')).toBeNull();
  });

  const bsePayload = (n: number, total: number, offset = 0) =>
    JSON.stringify({
      Table: Array.from({ length: n }, (_, i) => ({
        HEADLINE: `Announcement number ${offset + i} with unique words ${offset + i}`,
        NEWS_DT: '2025-02-01T10:00:00.000',
        ATTACHMENTNAME: `file-${offset + i}.pdf`,
        SLONGNAME: 'Reliance Industries Ltd',
      })),
      Table1: [{ ROWCNT: total }],
    });

  test('paginates until ROWCNT satisfied', async () => {
    const pages: string[] = [bsePayload(2, 3), bsePayload(1, 3, 2)];
    let call = 0;
    const result = await downloadScripWindow('500325', from, to, async () => pages[call++] ?? '{"Table": []}', 0);
    expect(result.failed).toBe(false);
    expect(result.items).toHaveLength(3);
    expect(call).toBe(2);
  });

  test('single page satisfying ROWCNT stops immediately', async () => {
    let call = 0;
    const result = await downloadScripWindow('500325', from, to, async () => {
      call++;
      return bsePayload(3, 3);
    }, 0);
    expect(result.items).toHaveLength(3);
    expect(call).toBe(1);
  });

  test('fetch failure marks the window failed', async () => {
    const result = await downloadScripWindow('500325', from, to, async () => null, 0);
    expect(result.failed).toBe(true);
  });
});
