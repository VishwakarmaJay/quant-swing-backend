import { describe, expect, test } from 'bun:test';

import { FundamentalFactor } from './fundamentalFactor';
import type { StockContext, StockFundamentals } from './types';

/** Minimal context — the factor reads only ctx.fundamentals. */
const ctx = (fundamentals: StockFundamentals | null): StockContext => ({
  symbol: 'TEST',
  asOf: '2026-07-18',
  candles: [],
  dataQualityScore: 1,
  sector: 'IT',
  benchmark: null,
  sectorPeers: null,
  fundamentals,
});

/** A complete snapshot with overridable fields. */
const snap = (over: Partial<StockFundamentals> = {}): StockFundamentals => ({
  pe: 20,
  sectorPeerPes: [10, 15, 20, 25, 30],
  ttmEps: 50,
  ttmEpsPrevYear: 40,
  quartersKnown: 8,
  daysSinceLastResult: 30,
  resultsPending: false,
  ...over,
});

const factor = new FundamentalFactor(); // minPeers 3, growthCap 40, value 0.6 / growth 0.4

describe('FundamentalFactor', () => {
  test('no fundamentals → neutral 50, agreement 0', () => {
    const r = factor.evaluate(ctx(null));
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
    expect(r.explanations[0]).toContain('no fundamental data');
  });

  test('zero known quarters → neutral', () => {
    const r = factor.evaluate(
      ctx(snap({ quartersKnown: 0, pe: null, ttmEps: null, ttmEpsPrevYear: null })),
    );
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
  });

  test('cheapest in sector + strong growth → high score', () => {
    // PE 10 vs peers [10,15,20,25,30] → 4 above + self tie → (4 + 0.5)/5 = 0.9 → value 90.
    // Growth +25% of cap 40 → 50 + (25/40)×50 = 81.25.
    const r = factor.evaluate(ctx(snap({ pe: 10, ttmEps: 50, ttmEpsPrevYear: 40 })));
    expect(r.metrics.valueScore).toBe(90);
    expect(r.metrics.growthScore).toBe(81.25);
    expect(r.score).toBe(86.5); // 0.6×90 + 0.4×81.25
    expect(r.agreementContribution).toBeGreaterThan(0);
  });

  test('most expensive in sector + shrinking earnings → low score', () => {
    // PE 30: 0 above + self tie → 0.5/5 = 0.1 → value 10. Growth −50% → clamps to 0.
    const r = factor.evaluate(ctx(snap({ pe: 30, ttmEps: 20, ttmEpsPrevYear: 40 })));
    expect(r.metrics.valueScore).toBe(10);
    expect(r.metrics.growthScore).toBe(0);
    expect(r.score).toBe(6);
    expect(r.agreementContribution).toBeLessThan(0);
  });

  test('growth saturates at ±growthCapPct', () => {
    const up = factor.evaluate(ctx(snap({ ttmEps: 100, ttmEpsPrevYear: 40 }))); // +150%
    expect(up.metrics.growthScore).toBe(100);
    const down = factor.evaluate(ctx(snap({ ttmEps: 10, ttmEpsPrevYear: 40 }))); // −75%
    expect(down.metrics.growthScore).toBe(0);
  });

  test('loss → profit turnaround scores growth 100', () => {
    const r = factor.evaluate(ctx(snap({ ttmEps: 5, ttmEpsPrevYear: -10 })));
    expect(r.metrics.growthScore).toBe(100);
    expect(r.metrics.epsTurnaround).toBe(true);
  });

  test('loss-making both years → growth dropped; loss-making PE → value dropped', () => {
    // Both components gone → neutral with explanation.
    const r = factor.evaluate(
      ctx(snap({ pe: null, ttmEps: -5, ttmEpsPrevYear: -10 })),
    );
    expect(r.score).toBe(50);
    expect(r.agreementContribution).toBe(0);
    expect(r.explanations.join(' ')).toContain('loss-making');
  });

  test('value-only when growth base missing (<8 quarters) — weight renormalizes', () => {
    const r = factor.evaluate(ctx(snap({ pe: 10, ttmEpsPrevYear: null, quartersKnown: 5 })));
    expect(r.metrics.valueScore).toBe(90);
    expect(r.metrics.growthScore).toBeUndefined();
    expect(r.score).toBe(90); // sole component carries full weight
  });

  test('growth-only when too few PE peers — weight renormalizes', () => {
    // Growth +20% of cap 40 → 50 + (20/40)×50 = 75, sole component.
    const r = factor.evaluate(ctx(snap({ sectorPeerPes: [20, 25], ttmEps: 48, ttmEpsPrevYear: 40 })));
    expect(r.metrics.valueScore).toBeUndefined();
    expect(r.score).toBe(75);
  });

  test('results-pending flag surfaces in metrics + explanation, not the score', () => {
    const base = factor.evaluate(ctx(snap()));
    const pending = factor.evaluate(ctx(snap({ resultsPending: true })));
    expect(pending.score).toBe(base.score);
    expect(pending.metrics.resultsPending).toBe(true);
    expect(pending.explanations.join(' ')).toContain('results pending');
  });

  test('deterministic: identical input → identical output', () => {
    const a = factor.evaluate(ctx(snap()));
    const b = factor.evaluate(ctx(snap()));
    expect(a).toEqual(b);
  });
});
