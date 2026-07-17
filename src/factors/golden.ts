import { assessDataQuality, type Candle } from '@/ohlcv';

import { buildFeatureBundle } from './featureBundle';
import { factors } from './registry';
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

const contextFromFixture = (stock: GoldenStock, fixture: GoldenFixture): StockContext => ({
  symbol: stock.symbol,
  asOf: fixture.asOf,
  candles: stock.candles,
  dataQualityScore: assessDataQuality(stock.candles, fixture.asOf).score,
  sector: stock.sector,
  benchmark: fixture.benchmark,
});

/**
 * Runs every registered factor over a fixture stock and returns the
 * deterministic result, dropping executionTimeMs (the one field that varies
 * run to run). This is what both `golden:update` and the golden test compute.
 */
export const evaluateGolden = (stock: GoldenStock, fixture: GoldenFixture): GoldenResult => {
  const bundle = buildFeatureBundle(contextFromFixture(stock, fixture), factors);
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
