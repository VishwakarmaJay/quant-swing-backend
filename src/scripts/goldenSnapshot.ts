import dayjs from 'dayjs';

import { BENCHMARK_ID, BENCHMARK_SYMBOL } from '@/factors';
import { GOLDEN_CANDLES, type GoldenFixture, type GoldenStock } from '@/factors/golden';
import type { Candle } from '@/ohlcv';
import { prisma } from '@services/prisma';

/**
 * Regenerates the golden INPUT fixture from the current DB — a fixed 15-stock
 * cross-section + the Nifty benchmark, capped to the last CANDLE_CAP candles.
 * Run rarely (only to refresh the dataset); the committed JSON is otherwise the
 * frozen source of truth. After running this, run `golden:update`.
 *
 *   bun run golden:snapshot
 */

const SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'SUNPHARMA', 'TORNTPHARM', 'MARUTI',
  'LT', 'TATASTEEL', 'BHARTIARTL', 'ITC', 'ASIANPAINT', 'TITAN', 'ADANIENT', 'BAJFINANCE',
];
const CANDLE_CAP = 210; // > EMA200 need (200) and RS lookback (60) with margin

const loadCandles = async (instrumentId: string): Promise<Candle[]> => {
  const rows = await prisma.ohlcv.findMany({
    where: { instrumentId },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });
  const candles = rows.map((r) => ({
    tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
  return candles.slice(-CANDLE_CAP);
};

const run = async () => {
  const stocks: GoldenStock[] = [];
  for (const name of SYMBOLS) {
    const inst = await prisma.instrument.findFirst({
      where: { name, instrumentType: 'EQ' },
      select: { id: true, sector: true },
    });
    if (!inst) {
      console.warn(`  skip ${name} — not found`);
      continue;
    }
    const candles = await loadCandles(inst.id);
    if (candles.length < 205) {
      console.warn(`  skip ${name} — only ${candles.length} candles`);
      continue;
    }
    stocks.push({ symbol: name, sector: inst.sector, candles });
  }

  const benchmark = { symbol: BENCHMARK_SYMBOL, candles: await loadCandles(BENCHMARK_ID) };
  const asOf = [...stocks.flatMap((s) => s.candles), ...benchmark.candles].reduce(
    (max, c) => (c.tradeDate > max ? c.tradeDate : max),
    '0000-00-00',
  );

  const fixture: GoldenFixture = { asOf, benchmark, stocks };
  await Bun.write(GOLDEN_CANDLES, JSON.stringify(fixture));
  console.log(`Wrote ${stocks.length} stocks + benchmark (asOf ${asOf}) → ${GOLDEN_CANDLES}`);
  console.log('Now run: bun run golden:update');
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
