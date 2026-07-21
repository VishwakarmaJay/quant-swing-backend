import { describe, expect, test } from 'bun:test';

import { normalizeMidcapSector } from './midcapSectors';

describe('normalizeMidcapSector', () => {
  test('folds cross-year taxonomy variants to one canonical sector', () => {
    expect(normalizeMidcapSector('Power')).toBe('Power');
    expect(normalizeMidcapSector('ENERGY')).toBe('Power'); // old NSE label for power/utilities
    expect(normalizeMidcapSector('IT')).toBe('IT');
    expect(normalizeMidcapSector('Information Technology')).toBe('IT');
    expect(normalizeMidcapSector('PHARMA')).toBe('Healthcare');
    expect(normalizeMidcapSector('Healthcare')).toBe('Healthcare');
    expect(normalizeMidcapSector('AUTOMOBILE')).toBe('Auto');
    expect(normalizeMidcapSector('Automobile and Auto Components')).toBe('Auto');
    expect(normalizeMidcapSector('Fast Moving Consumer Goods')).toBe('FMCG');
  });

  test('is case-insensitive and trims', () => {
    expect(normalizeMidcapSector('  financial services ')).toBe('Financial Services');
  });

  test('keeps Oil & Gas distinct from Power', () => {
    expect(normalizeMidcapSector('Oil Gas & Consumable Fuels')).toBe('Oil & Gas');
    expect(normalizeMidcapSector('ENERGY')).not.toBe('Oil & Gas');
  });

  test('unknown label passes through (so the ingest can report it)', () => {
    expect(normalizeMidcapSector('Some New Sector')).toBe('Some New Sector');
  });
});
