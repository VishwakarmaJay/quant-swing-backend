import { describe, expect, test } from 'bun:test';

import { isMemberOn, UNIVERSE_MEMBERSHIP } from './membership';

describe('universe membership (B8.2)', () => {
  test('no entry → always a member', () => {
    expect(isMemberOn('RELIANCE', '2021-01-01')).toBe(true);
    expect(isMemberOn('RELIANCE', '2026-07-18')).toBe(true);
  });

  test('window semantics: from inclusive, to exclusive', () => {
    const m = {
      X: { from: '2024-01-01', to: '2025-06-01' },
      ONLYFROM: { from: '2024-01-01' },
      ONLYTO: { to: '2025-06-01' },
    };
    expect(isMemberOn('X', '2023-12-31', m)).toBe(false);
    expect(isMemberOn('X', '2024-01-01', m)).toBe(true);
    expect(isMemberOn('X', '2025-05-31', m)).toBe(true);
    expect(isMemberOn('X', '2025-06-01', m)).toBe(false); // to is exclusive
    expect(isMemberOn('ONLYFROM', '2026-01-01', m)).toBe(true);
    expect(isMemberOn('ONLYTO', '2020-01-01', m)).toBe(true);
    expect(isMemberOn('UNLISTED-IN-MAP', '2020-01-01', m)).toBe(true);
  });

  test('current committed map is sparse and shaped correctly', () => {
    for (const [symbol, w] of Object.entries(UNIVERSE_MEMBERSHIP)) {
      expect(symbol).toMatch(/^[A-Z0-9&-]+$/);
      if (w.from) expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (w.to) expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (w.from && w.to) expect(w.from < w.to).toBe(true);
    }
  });
});
