import {
  evaluateGolden,
  GOLDEN_EXPECTED,
  loadFixture,
  type GoldenExpected,
} from '@/factors/golden';

/**
 * Regenerates the golden EXPECTED output from the committed fixture + the
 * CURRENT factor code. Run this ONLY when a factor change is intentional, then
 * review the diff and justify it in the PR (docs TESTING_GUIDE). Does not touch
 * the DB — pure recompute from the committed candles.
 *
 *   bun run golden:update
 */
const run = async () => {
  const fixture = await loadFixture();
  const expected: GoldenExpected = {};
  for (const stock of fixture.stocks) expected[stock.symbol] = evaluateGolden(stock, fixture);

  await Bun.write(GOLDEN_EXPECTED, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(
    `Wrote golden output for ${fixture.stocks.length} stocks → ${GOLDEN_EXPECTED}\n` +
      'Review the diff and justify any change in your PR.',
  );
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
