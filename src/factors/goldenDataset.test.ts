import { describe, expect, test } from 'bun:test';

import { evaluateGolden, loadExpected, loadFixture } from './golden';

/**
 * Golden determinism gate (docs Phase 2.5): every registered factor must
 * produce byte-identical output on the committed fixture. A drift here means a
 * factor's numbers changed — intended changes are re-baselined with
 * `bun run golden:update` and justified in review; unintended ones are caught.
 */

const fixture = await loadFixture();
const expected = await loadExpected();

describe('golden dataset — deterministic factor output', () => {
  test('fixture and golden cover the same stocks', () => {
    expect(fixture.stocks.map((s) => s.symbol).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const stock of fixture.stocks) {
    test(`${stock.symbol}: factor output matches golden`, () => {
      expect(evaluateGolden(stock, fixture)).toEqual(expected[stock.symbol]!);
    });
  }
});
