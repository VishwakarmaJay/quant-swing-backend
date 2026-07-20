import { describe, expect, test } from 'bun:test';

import { byCanonicalSymbol, canonicalSymbol } from './symbols';

describe('canonicalSymbol', () => {
  test('strips the NSE equity series suffix', () => {
    expect(canonicalSymbol('ABB-EQ')).toBe('ABB');
    expect(canonicalSymbol('RELIANCE-EQ')).toBe('RELIANCE');
  });

  test('is idempotent — safe to apply at any boundary without checking', () => {
    expect(canonicalSymbol(canonicalSymbol('TCS-EQ'))).toBe('TCS');
    expect(canonicalSymbol('TCS')).toBe('TCS');
  });

  test('leaves index rows (no series suffix) untouched', () => {
    expect(canonicalSymbol('NIFTY')).toBe('NIFTY');
    expect(canonicalSymbol('India VIX')).toBe('India VIX');
  });

  test('preserves hyphens that are part of the name, not a series suffix', () => {
    // The regression that matters: BAJAJ-AUTO must NOT become BAJAJ.
    expect(canonicalSymbol('BAJAJ-AUTO')).toBe('BAJAJ-AUTO');
    expect(canonicalSymbol('BAJAJ-AUTO-EQ')).toBe('BAJAJ-AUTO');
    expect(canonicalSymbol('M&M-EQ')).toBe('M&M');
  });

  test('only strips a TRAILING suffix', () => {
    expect(canonicalSymbol('EQ-SOMETHING')).toBe('EQ-SOMETHING');
  });
});

describe('byCanonicalSymbol', () => {
  const rows = [
    { symbol: 'ABB-EQ', v: 1 },
    { symbol: 'BAJAJ-AUTO-EQ', v: 2 },
    { symbol: 'NIFTY', v: 3 },
  ];

  test('keys the lookup in canonical space so news/fundamentals joins hit', () => {
    const { map } = byCanonicalSymbol(rows, (r) => r.symbol);
    expect(map.get('ABB')!.v).toBe(1);
    expect(map.get('BAJAJ-AUTO')!.v).toBe(2); // the exact join the B12 study missed
    expect(map.get('NIFTY')!.v).toBe(3);
    expect(map.get('ABB-EQ')).toBeUndefined(); // instrument-space keys are gone
  });

  test('reports collisions instead of silently dropping rows', () => {
    const { map, collisions } = byCanonicalSymbol(
      [
        { symbol: 'X-EQ', v: 1 },
        { symbol: 'X-BE', v: 2 },
      ],
      (r) => r.symbol,
    );
    expect(collisions).toEqual(['X']);
    expect(map.get('X')!.v).toBe(1); // first wins, deterministically
  });

  test('no collisions on a clean set', () => {
    expect(byCanonicalSymbol(rows, (r) => r.symbol).collisions).toEqual([]);
  });
});
