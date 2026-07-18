import { describe, expect, test } from 'bun:test';

import { NewsOrigin } from '@generated/prisma/enums';

import { normalizeTitle } from '../dedupe';
import type { RawFeedItem } from '../types';
import { bseRowKey, processBseItems, BSE_SOURCE } from './backfill';
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
    const result = processBseItems([item({ title: 'Results for Q4' })], IMPORTED_AT, 30, new Set(), new Set());
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
      new Set(),
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
      new Set(),
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
    const corpus = new Set<string>();
    const keys = new Set<string>();
    const items = [item({ title: 'Reliance Industries allotment of NCDs tranche one' })];

    const first = processBseItems(items, IMPORTED_AT, 30, corpus, keys);
    expect(first.rows).toHaveLength(1);
    const second = processBseItems(items, IMPORTED_AT, 30, corpus, keys);
    expect(second.rows).toHaveLength(0);
    expect(second.alreadyStored).toBe(1);
    expect(second.duplicates).toBe(0);
  });

  test('near-duplicate titles vs corpus are dropped', () => {
    const corpus = new Set([normalizeTitle('Tata Motors reports record commercial vehicle sales in March')]);
    const result = processBseItems(
      [item({ title: 'Tata Motors reports record commercial vehicle sales for March', url: 'https://x.test/other.pdf' })],
      IMPORTED_AT,
      30,
      corpus,
      new Set(),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.duplicates).toBe(1);
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
