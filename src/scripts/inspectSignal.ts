import { atr, round } from '@/factors/indicators';
import { buildStockContext, loadFundamentalInputs } from '@/factors';
import { computeSignalLevels } from '@/signal';
import { prisma } from '@services/prisma';

/**
 * Drill into one stock's signal math — entry, ATR, both stop candidates, and
 * the verdict — to see exactly why a trade is accepted or rejected.
 *
 *   bun run signal:inspect BIOCON
 */
const run = async () => {
  const name = (process.argv[2] ?? '').toUpperCase();
  const inst = await prisma.instrument.findFirst({
    where: { name, instrumentType: 'EQ' },
    select: { id: true, symbol: true },
  });
  if (!inst) {
    console.error(`No EQ instrument named "${name}"`);
    process.exitCode = 1;
    return;
  }

  const ctx = await buildStockContext(inst.id, new Date(), {
    fundamentalInputs: await loadFundamentalInputs(),
  });
  if (!ctx) return;
  const highs = ctx.candles.map((c) => c.high);
  const lows = ctx.candles.map((c) => c.low);
  const closes = ctx.candles.map((c) => c.close);
  const entry = closes.at(-1)!;
  const atrVal = atr(highs, lows, closes, 14).filter((v) => !Number.isNaN(v)).at(-1)!;
  const atrPct = round((atrVal / entry) * 100, 2);
  const mult = atrPct < 1.5 ? 2.0 : 1.5;
  const slAtr = round(entry - mult * atrVal, 2);
  const swingLow = Math.min(...lows.slice(-15));
  const slSwing = round(swingLow * 0.997, 2);

  console.log(`\n${inst.symbol}  entry=${round(entry, 2)}`);
  console.log(`  ATR=${round(atrVal, 2)}  ATR%=${atrPct}  → mult ${mult}`);
  console.log(`  SL_ATR=${slAtr} (${round(((entry - slAtr) / entry) * 100, 2)}%)  ` +
    `SL_SWING=${slSwing} (${round(((entry - slSwing) / entry) * 100, 2)}%)`);

  const result = computeSignalLevels(ctx.candles);
  if (result.ok) {
    console.log(`  ✓ SIGNAL: SL ${result.stopLoss} (${result.slPct}%), T1 ${result.target1}, T2 ${result.target2}, ` +
      `R:R→resistance ${result.rrToResistance ?? '∞'}`);
  } else {
    console.log(`  ✗ REJECTED (${result.reason}): ${result.detail}`);
  }
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
