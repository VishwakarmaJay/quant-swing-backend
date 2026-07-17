import { describe, expect, test } from 'bun:test';

import type { PipelineRun, PipelineSignal } from '@/pipeline';
import { MarketRegime } from '@/regime';
import { formatSignalAlert } from './alertFormatter';

const signal = (o: Partial<PipelineSignal> = {}): PipelineSignal => ({
  instrumentId: 'NSE:BHEL-EQ',
  symbol: 'BHEL',
  sector: 'Infra / Capital Goods',
  regime: MarketRegime.SIDEWAYS,
  compositeScore: 91.28,
  agreementScore: 0.7,
  entry: 435.4,
  entryLow: 433.22,
  entryHigh: 437.58,
  stopLoss: 411.72,
  target1: 482.76,
  target2: 506.44,
  riskPerShare: 23.68,
  rrToResistance: null,
  atrPct: 3.1,
  qty: 156,
  positionValue: 67922.4,
  allocatedCapital: 91280,
  riskAmount: 3694.08,
  sizeReduced: true,
  ...o,
});

const run = (approved: PipelineSignal[], rejectionCount = 0): PipelineRun => ({
  runId: 'r1',
  asOf: '2026-07-17',
  regime: MarketRegime.SIDEWAYS,
  regimeDetail: 'Nifty below EMA200, breadth 54.5% — mixed',
  approved,
  rejections: Array.from({ length: rejectionCount }, (_, i) => ({
    instrumentId: `x${i}`,
    symbol: `X${i}`,
    stage: 'strategy',
    reason: 'composite',
    detail: '',
  })),
  versions: {
    snapshotSchemaVersion: '1.0.0',
    weightsVersion: 'w-1',
    engineVersion: 'dev',
    instrumentMasterVersion: 'im-1',
    factorConfigChecksum: 'f-1',
  },
});

describe('formatSignalAlert', () => {
  test('renders a signal with levels, sizing, and scores', () => {
    const msg = formatSignalAlert(run([signal()], 165));
    expect(msg).toContain('QuantSwing');
    expect(msg).toContain('*SIDEWAYS*');
    expect(msg).toContain('1 signal');
    expect(msg).toContain('*1. BHEL*');
    expect(msg).toContain('BUY');
    expect(msg).toContain('Qty 156');
    expect(msg).toContain('SL ₹411.72');
    expect(msg).toContain('_size-reduced_');
    expect(msg).toContain('manually');
  });

  test('pluralizes and numbers multiple signals', () => {
    const msg = formatSignalAlert(run([signal(), signal({ symbol: 'BAJAJ-AUTO', sizeReduced: false })], 3));
    expect(msg).toContain('2 signals');
    expect(msg).toContain('*2. BAJAJ-AUTO*');
  });

  test('renders a no-signal run with regime + top reasons', () => {
    const msg = formatSignalAlert(run([], 167));
    expect(msg).toContain('No signals today');
    expect(msg).toContain('167 candidates');
    expect(msg).toContain('composite');
    expect(msg).toContain('Silence is often the system working');
  });

  test('is deterministic', () => {
    const r = run([signal()], 10);
    expect(formatSignalAlert(r)).toBe(formatSignalAlert(r));
  });
});
