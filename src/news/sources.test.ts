import { describe, expect, test } from 'bun:test';

import { NEWS_SOURCES, resolveSourceUrl } from './sources';

describe('resolveSourceUrl', () => {
  test('substitutes {from}/{to} as YYYYMMDD (yesterday → fetch day)', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'BSE_ANNOUNCEMENTS')!;
    const url = resolveSourceUrl(src, new Date(2026, 6, 18)); // 18 Jul 2026 local
    expect(url).toContain('strPrevDate=20260717');
    expect(url).toContain('strToDate=20260718');
    expect(url).not.toContain('{from}');
    expect(url).not.toContain('{to}');
  });

  test('returns placeholder-free URLs untouched', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'LIVEMINT')!;
    expect(resolveSourceUrl(src, new Date())).toBe(src.url);
  });

  test('BSE source carries the Referer header its WAF requires', () => {
    const src = NEWS_SOURCES.find((s) => s.id === 'BSE_ANNOUNCEMENTS')!;
    expect(src.headers?.Referer).toContain('bseindia.com');
  });
});
