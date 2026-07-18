import { describe, expect, test } from 'bun:test';

import { NEWS_SOURCES, resolveSourceUrls } from './sources';

describe('resolveSourceUrls', () => {
  test('BSE {date} expands into TWO single-day windows (yesterday + today)', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'BSE_ANNOUNCEMENTS')!;
    const urls = resolveSourceUrls(src, new Date(2026, 6, 18)); // 18 Jul 2026 local
    expect(urls).toHaveLength(2);
    // The API rejects multi-day ranges, so each URL must have strPrevDate === strToDate.
    expect(urls[0]).toContain('strPrevDate=20260717');
    expect(urls[0]).toContain('strToDate=20260717');
    expect(urls[1]).toContain('strPrevDate=20260718');
    expect(urls[1]).toContain('strToDate=20260718');
    for (const u of urls) expect(u).not.toContain('{date}');
  });

  test('placeholder-free URLs pass through as a single entry', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'LIVEMINT')!;
    expect(resolveSourceUrls(src, new Date())).toEqual([src.url]);
  });

  test('BSE source targets AnnSubCategoryGetData and carries the required Referer', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'BSE_ANNOUNCEMENTS')!;
    expect(src.url).toContain('AnnSubCategoryGetData');
    expect(src.url).toContain('subcategory=-1');
    expect(src.headers?.Referer).toContain('bseindia.com');
  });
});
