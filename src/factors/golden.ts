import { assessDataQuality, type Candle } from '@/ohlcv';

import { buildFeatureBundle } from './featureBundle';
import { lookbackReturnPct } from './indicators';
import { factors } from './registry';
import { DEFAULT_SECTOR_RS_CONFIG } from './sectorRelativeStrengthFactor';
import type { FactorOutput, StockContext } from './types';

/**
 * Golden dataset (docs Phase 2.5): a fixed, committed fixture of real candles
 * for ~15 stocks + the benchmark, and the factor output they must produce
 * byte-for-byte. The test asserts current output equals the committed golden;
 * any factor logic change that shifts output fails CI until the golden is
 * consciously regenerated (`bun run golden:update`) and justified in review.
 *
 * This module is the single evaluator shared by the updater and the test, so
 * the "expected" and the "actual" can never be computed differently.
 */

export const GOLDEN_DIR = `${import.meta.dir}/__fixtures__`;
export const GOLDEN_CANDLES = `${GOLDEN_DIR}/golden-candles.json`;
export const GOLDEN_EXPECTED = `${GOLDEN_DIR}/golden-expected.json`;

export type GoldenStock = { symbol: string; sector: string | null; candles: Candle[] };

export type GoldenFixture = {
  asOf: string;
  benchmark: { symbol: string; candles: Candle[] };
  stocks: GoldenStock[];
};

/** One stock's deterministic factor output — everything except timing. */
export type GoldenResult = {
  dataQualityScore: number;
  results: Record<string, FactorOutput>;
};

export type GoldenExpected = Record<string, GoldenResult>;

/** Sector → lookback returns across the fixture stocks (cross-sectional pre-pass). */
const sectorReturnsFromFixture = (fixture: GoldenFixture): Map<string, number[]> => {
  const bySector = new Map<string, number[]>();
  for (const s of fixture.stocks) {
    if (!s.sector) continue;
    const ret = lookbackReturnPct(s.candles.map((c) => c.close), DEFAULT_SECTOR_RS_CONFIG.lookback);
    if (ret === null) continue;
    (bySector.get(s.sector) ?? bySector.set(s.sector, []).get(s.sector)!).push(ret);
  }
  return bySector;
};

const contextFromFixture = (
  stock: GoldenStock,
  fixture: GoldenFixture,
  sectorReturns: Map<string, number[]>,
): StockContext => ({
  symbol: stock.symbol,
  asOf: fixture.asOf,
  candles: stock.candles,
  dataQualityScore: assessDataQuality(stock.candles, fixture.asOf).score,
  sector: stock.sector,
  benchmark: fixture.benchmark,
  sectorPeers: stock.sector
    ? { peerReturnsPct: sectorReturns.get(stock.sector) ?? [], lookback: DEFAULT_SECTOR_RS_CONFIG.lookback }
    : null,
});

/**
 * Runs every registered factor over a fixture stock and returns the
 * deterministic result, dropping executionTimeMs (the one field that varies
 * run to run). This is what both `golden:update` and the golden test compute.
 */
export const evaluateGolden = (stock: GoldenStock, fixture: GoldenFixture): GoldenResult => {
  const bundle = buildFeatureBundle(
    contextFromFixture(stock, fixture, sectorReturnsFromFixture(fixture)),
    factors,
  );
  const results: Record<string, FactorOutput> = {};
  for (const [name, r] of Object.entries(bundle.results)) {
    results[name] = {
      score: r.score,
      agreementContribution: r.agreementContribution,
      explanations: r.explanations,
      metrics: r.metrics,
    };
  }
  return { dataQualityScore: bundle.dataQualityScore, results };
};

export const loadFixture = (): Promise<GoldenFixture> => Bun.file(GOLDEN_CANDLES).json();
export const loadExpected = (): Promise<GoldenExpected> => Bun.file(GOLDEN_EXPECTED).json();
