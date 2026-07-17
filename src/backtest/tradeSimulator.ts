import dayjs from 'dayjs';

import { emaLatest, macdLatest, round } from '@/factors/indicators';
import type { Candle } from '@/ohlcv';

/**
 * Trade simulator (docs TRADING_RULES exits). Given the full candle series, the
 * signal day, and the trade levels, walks the trade forward day-by-day and
 * applies the exit triggers, transaction cost, and fixed-bps slippage. Pure and
 * deterministic. Entry fills at the NEXT day's open (a signal fires on the
 * close, you enter next morning). Sentiment-based thesis break is omitted — no
 * historical sentiment (documented limitation).
 *
 * Exit priority each day (SL checked first = conservative):
 *   1. stop-loss     : low ≤ SL            → exit remainder at SL
 *   2. target1        : high ≥ T1 & !taken  → sell 50% at T1, move SL to breakeven
 *   3. target2        : high ≥ T2           → exit remainder at T2
 *   4. time-stop      : held ≥ 7 cal days   → exit remainder at close
 *   5. thesis-break   : 2 closes < EMA20 OR MACD histogram flips negative → exit at close
 *   (end-of-data)     : ran out of candles  → mark out at last close
 */

export type ExitReason =
  | 'stop-loss'
  | 'target1-partial'
  | 'target2'
  | 'time-stop'
  | 'thesis-break'
  | 'end-of-data';

export type TradeExit = { date: string; price: number; fraction: number; reason: ExitReason };

export type ClosedTrade = {
  symbol: string;
  sector: string | null;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exits: TradeExit[];
  exitDate: string;
  holdingDays: number;
  grossReturnPct: number;
  netReturnPct: number;
  maePct: number;
  mfePct: number;
  win: boolean;
  finalReason: ExitReason;
};

export type TradeLevels = { stopLoss: number; target1: number; target2: number };

export type SimulatorConfig = {
  slippageBps: number;
  costPctPerSide: number;
  timeStopDays: number;
  emaPeriod: number;
};

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  slippageBps: 5, // 0.05% each side
  costPctPerSide: 0.05, // 0.05% each side (≈0.10% round trip)
  timeStopDays: 7,
  emaPeriod: 20,
};

export const simulateTrade = (
  candles: readonly Candle[],
  signalIndex: number,
  levels: TradeLevels,
  meta: { symbol: string; sector: string | null },
  config: SimulatorConfig = DEFAULT_SIMULATOR_CONFIG,
): ClosedTrade | null => {
  const entryIdx = signalIndex + 1;
  if (entryIdx >= candles.length) return null; // signal on the last available day

  const slip = config.slippageBps / 10_000;
  const closes = candles.map((c) => c.close);
  const entryCandle = candles[entryIdx]!;
  const entryPrice = round(entryCandle.open * (1 + slip), 2);

  const entryMacd = macdLatest(closes.slice(0, entryIdx + 1), 12, 26, 9);
  const entryHistPositive = entryMacd ? entryMacd.histogram > 0 : true;

  let sl = levels.stopLoss;
  let t1Taken = false;
  let remaining = 1;
  let closesBelowEma = 0;
  let mae = 0;
  let mfe = 0;
  const exits: TradeExit[] = [];

  const sell = (idx: number, price: number, fraction: number, reason: ExitReason) => {
    exits.push({ date: candles[idx]!.tradeDate, price: round(price, 2), fraction, reason });
    remaining = round(remaining - fraction, 6);
  };

  for (let i = entryIdx; i < candles.length && remaining > 0; i++) {
    const c = candles[i]!;
    mae = Math.min(mae, ((c.low - entryPrice) / entryPrice) * 100);
    mfe = Math.max(mfe, ((c.high - entryPrice) / entryPrice) * 100);

    // 1. Stop loss (conservative: checked before targets).
    if (c.low <= sl) {
      sell(i, sl, remaining, 'stop-loss');
      break;
    }

    // 2/3. Targets.
    if (!t1Taken && c.high >= levels.target1) {
      sell(i, levels.target1, 0.5, 'target1-partial');
      t1Taken = true;
      sl = entryPrice; // move stop to breakeven
      if (c.high >= levels.target2) {
        sell(i, levels.target2, remaining, 'target2');
        break;
      }
      continue;
    }
    if (t1Taken && c.high >= levels.target2) {
      sell(i, levels.target2, remaining, 'target2');
      break;
    }

    // 4. Time stop.
    if (dayjs(c.tradeDate).diff(dayjs(entryCandle.tradeDate), 'day') >= config.timeStopDays) {
      sell(i, c.close, remaining, 'time-stop');
      break;
    }

    // 5. Thesis break (sentiment omitted — no historical archive).
    const ema = emaLatest(closes.slice(0, i + 1), config.emaPeriod);
    closesBelowEma = ema !== null && c.close < ema ? closesBelowEma + 1 : 0;
    const macd = macdLatest(closes.slice(0, i + 1), 12, 26, 9);
    const macdFlip = entryHistPositive && macd !== null && macd.histogram < 0;
    if (closesBelowEma >= 2 || macdFlip) {
      sell(i, c.close, remaining, 'thesis-break');
      break;
    }
  }

  if (remaining > 0.0001) {
    const lastIdx = candles.length - 1;
    sell(lastIdx, candles[lastIdx]!.close, remaining, 'end-of-data');
  }

  // Net return: slippage is already in the fills; subtract round-trip commission.
  let grossReturn = 0;
  for (const e of exits) {
    const exitFill = e.price * (1 - slip);
    grossReturn += ((exitFill - entryPrice) / entryPrice) * e.fraction;
  }
  const grossReturnPct = round(grossReturn * 100, 3);
  const netReturnPct = round((grossReturn - 2 * (config.costPctPerSide / 100)) * 100, 3);

  const lastExit = exits[exits.length - 1]!;
  return {
    symbol: meta.symbol,
    sector: meta.sector,
    signalDate: candles[signalIndex]!.tradeDate,
    entryDate: entryCandle.tradeDate,
    entryPrice,
    exits,
    exitDate: lastExit.date,
    holdingDays: dayjs(lastExit.date).diff(dayjs(entryCandle.tradeDate), 'day'),
    grossReturnPct,
    netReturnPct,
    maePct: round(mae, 2),
    mfePct: round(mfe, 2),
    win: netReturnPct > 0,
    finalReason: lastExit.reason,
  };
};
