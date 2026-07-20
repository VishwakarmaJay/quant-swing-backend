import { describe, expect, test } from 'bun:test';

import { MarketRegime } from '@/regime';
import { PortfolioManager } from './portfolioManager';
import { DEFAULT_PORTFOLIO_CONFIG, type PortfolioCandidate } from './types';

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
/** The legacy composite-scaled model — no longer the default (B11), still switchable. */
const pmConviction = new PortfolioManager({ ...DEFAULT_PORTFOLIO_CONFIG, sizingMode: 'conviction' });

describe('PortfolioManager', () => {
  // baseCapitalPerTrade = 100_000, scaled by composite ÷ 100 (conviction mode).
  test('sizes capital by conviction (composite score)', () => {
    const { approved } = pmConviction.manage([
      candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2 }),
    ]);
    expect(approved).toHaveLength(1);
    expect(approved[0]!.allocatedCapital).toBe(90_000); // 100_000 × 0.90
    expect(approved[0]!.qty).toBe(900); // floor(90_000 / 100)
    expect(approved[0]!.positionValue).toBe(90_000);
  });

  test('higher conviction gets more capital', () => {
    const low = pmConviction.manage([candidate({ symbol: 'A', sector: 'IT', composite: 65, entry: 100, riskPerShare: 2 })]);
    const high = pmConviction.manage([candidate({ symbol: 'B', sector: 'IT', composite: 95, entry: 100, riskPerShare: 2 })]);
    expect(high.approved[0]!.qty).toBeGreaterThan(low.approved[0]!.qty);
  });

  test('rejects only when entry exceeds the allocated capital (qty 0)', () => {
    const { approved, rejected } = pmConviction.manage([
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

/**
 * Risk sizing is the DEFAULT since 2026-07-20 (B9 + B11 evidence). It mirrors the
 * portfolio simulator's `risk` mode, so live sizing is the model that was actually
 * backtested. Book = baseCapitalPerTrade × maxOpenPositions = ₹200,000; 1% risk
 * per trade = ₹2,000 at risk.
 */
describe('PortfolioManager — risk sizing (default)', () => {
  test('qty comes from the stop distance, not the composite', () => {
    const { approved } = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 90, entry: 100, riskPerShare: 2 })]);
    expect(approved[0]!.qty).toBe(1000); // ₹2,000 risk ÷ ₹2/share
    expect(approved[0]!.riskAmount).toBe(2000); // the risk envelope is honoured exactly
  });

  test('composite does NOT change the size (the B11 point)', () => {
    const low = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 66, entry: 100, riskPerShare: 2 })]);
    const high = pm.manage([candidate({ symbol: 'B', sector: 'IT', composite: 99, entry: 100, riskPerShare: 2 })]);
    expect(high.approved[0]!.qty).toBe(low.approved[0]!.qty);
  });

  test('a wider stop takes a smaller position (constant rupee risk)', () => {
    const tight = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 80, entry: 100, riskPerShare: 2 })]);
    const wide = pm.manage([candidate({ symbol: 'B', sector: 'IT', composite: 80, entry: 100, riskPerShare: 8 })]);
    expect(wide.approved[0]!.qty).toBe(250); // ₹2,000 ÷ ₹8
    expect(tight.approved[0]!.qty).toBe(1000);
    // Same rupees at risk either way — that is the whole point of the model.
    expect(wide.approved[0]!.riskAmount).toBe(tight.approved[0]!.riskAmount);
  });

  test('the slot budget caps a tight stop (no book-consuming position)', () => {
    // Uncapped this would be ₹2,000 risk ÷ ₹0.50 = 4,000 shares × ₹100 = ₹400,000,
    // i.e. 2× the whole book on one trade. The slot budget clamps it to ₹100,000.
    const { approved } = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 80, entry: 100, riskPerShare: 0.5 })]);
    expect(approved[0]!.qty).toBe(1000); // floor(100,000 slot budget / 100), not 4,000
    expect(approved[0]!.positionValue).toBeLessThanOrEqual(DEFAULT_PORTFOLIO_CONFIG.baseCapitalPerTrade);
    // Clamped ⇒ less than the full risk envelope is actually deployed.
    expect(approved[0]!.riskAmount).toBeLessThan(2000);
  });

  test('the volatility size-reduction still applies on top', () => {
    const full = pm.manage([candidate({ symbol: 'A', sector: 'IT', composite: 80, entry: 100, riskPerShare: 2, atrPct: 1 })]);
    const reduced = pm.manage([candidate({ symbol: 'B', sector: 'IT', composite: 80, entry: 100, riskPerShare: 2, atrPct: 4 })]);
    expect(reduced.approved[0]!.qty).toBe(Math.floor(full.approved[0]!.qty * 0.75));
    expect(reduced.approved[0]!.sizeReduced).toBe(true);
  });
});
