import { describe, expect, test } from 'bun:test';

import { MarketRegime } from '@/regime';
import { PortfolioManager } from './portfolioManager';
import type { PortfolioCandidate } from './types';

const candidate = (o: {
  symbol: string;
  sector: string | null;
  composite: number;
  entry: number;
  riskPerShare: number;
  atrPct?: number;
  target1?: number;
}): PortfolioCandidate => ({
  symbol: o.symbol,
  sector: o.sector,
  regime: MarketRegime.BULL,
  compositeScore: o.composite,
  agreementScore: 0.7,
  levels: {
    entry: o.entry,
    entryLow: o.entry * 0.995,
    entryHigh: o.entry * 1.005,
    stopLoss: o.entry - o.riskPerShare,
    riskPerShare: o.riskPerShare,
    slPct: (o.riskPerShare / o.entry) * 100,
    target1: o.target1 ?? o.entry + 2 * o.riskPerShare,
    target2: o.entry + 3 * o.riskPerShare,
    resistance: null,
    rrToResistance: null,
    atr: o.riskPerShare,
    atrPct: o.atrPct ?? 1.0,
  },
});

const pm = new PortfolioManager();

describe('PortfolioManager', () => {
  // Default baseCapitalPerTrade = 100_000, scaled by composite ÷ 100.
  test('sizes capital by conviction (composite score)', () => {
    const { approved } = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2 })]);
    expect(approved).toHaveLength(1);
    expect(approved[0]!.allocatedCapital).toBe(90_000); // 100_000 × 0.90
    expect(approved[0]!.qty).toBe(900); // floor(90_000 / 100)
    expect(approved[0]!.positionValue).toBe(90_000);
  });

  test('higher conviction gets more capital', () => {
    const low = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 65, entry: 100, riskPerShare: 2 })]);
    const high = pm.manage([candidate({ symbol: 'B', sector: 'IT', composite: 95, entry: 100, riskPerShare: 2 })]);
    expect(high.approved[0]!.qty).toBeGreaterThan(low.approved[0]!.qty);
  });

  test('rejects only when entry exceeds the allocated capital (qty 0)', () => {
    const { approved, rejected } = pm.manage([
      candidate({ symbol: 'A', sector: 'IT', composite: 65, entry: 70_000, riskPerShare: 60 }),
    ]);
    expect(approved).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('sizing'); // 65_000 allocated < ₹70_000 entry
  });

  test('applies the volatility size-reduction in the 3–6% ATR band', () => {
    const full = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2, atrPct: 1 })]);
    const reduced = pm.manage([candidate({ symbol: 'B', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2, atrPct: 4 })]);
    expect(reduced.approved[0]!.qty).toBe(Math.floor(full.approved[0]!.qty * 0.75));
    expect(reduced.approved[0]!.sizeReduced).toBe(true);
  });

  test('honors the 2-position limit, filling by composite rank', () => {
    const { approved, rejected } = pm.manage([
      candidate({ symbol: 'A', sector: 'IT', composite: 70, entry: 100, riskPerShare: 2 }),
      candidate({ symbol: 'B', sector: 'Banks', composite: 90, entry: 100, riskPerShare: 2 }),
      candidate({ symbol: 'C', sector: 'Auto', composite: 80, entry: 100, riskPerShare: 2 }),
    ]);
    expect(approved.map((a) => a.symbol)).toEqual(['B', 'C']); // top 2 by composite
    expect(rejected.find((r) => r.symbol === 'A')!.reason).toBe('position-limit');
  });

  test('enforces one position per sector', () => {
    const { approved, rejected } = pm.manage([
      candidate({ symbol: 'A', sector: 'Banks', composite: 90, entry: 100, riskPerShare: 2 }),
      candidate({ symbol: 'B', sector: 'Banks', composite: 80, entry: 100, riskPerShare: 2 }),
    ]);
    expect(approved.map((a) => a.symbol)).toEqual(['A']);
    expect(rejected.find((r) => r.symbol === 'B')!.reason).toBe('sector-cap');
  });

  test('open positions consume slots and sector capacity', () => {
    const { approved, rejected } = pm.manage(
      [
        candidate({ symbol: 'A', sector: 'Banks', composite: 90, entry: 100, riskPerShare: 2 }),
        candidate({ symbol: 'B', sector: 'IT', composite: 80, entry: 100, riskPerShare: 2 }),
      ],
      { openPositions: [{ sector: 'Banks' }], dailyRealizedLoss: 0 },
    );
    // 1 slot left, Banks already held → A rejected sector-cap, B takes the slot.
    expect(approved.map((a) => a.symbol)).toEqual(['B']);
    expect(rejected.find((r) => r.symbol === 'A')!.reason).toBe('sector-cap');
  });

  test('kill switch blocks everything', () => {
    const { approved, rejected } = pm.manage(
      [candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2 })],
      { openPositions: [], dailyRealizedLoss: 5_000 },
    );
    expect(approved).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('kill-switch');
  });

  test('rejects a trade whose expected return cannot clear cost drag', () => {
    // Very tight stop (0.3%) → target reward too small vs round-trip cost.
    const { approved, rejected } = pm.manage([
      candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 0.3 }),
    ]);
    expect(approved).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('cost-drag');
  });

  test('is deterministic', () => {
    const cands = [
      candidate({ symbol: 'A', sector: 'IT', composite: 88, entry: 120, riskPerShare: 3 }),
      candidate({ symbol: 'B', sector: 'Banks', composite: 76, entry: 90, riskPerShare: 2 }),
    ];
    expect(pm.manage(cands)).toEqual(pm.manage(cands));
  });
});
