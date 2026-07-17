import type { Instrument } from '@generated/prisma/client';
import { OrderStatus } from '@generated/prisma/enums';
import { io } from '@/socket/connection';
import { hasAngelOneCredentials } from '@services/angelOne';
import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { redis } from '@services/redis';
import { getIndexInstruments } from './activeInstruments';
import { AngelOneStream } from './angelOneStream';
import type { LtpUpdate } from './ltpUpdate';

const LTP_CACHE_TTL_SECONDS = 5;
/** Redis pub/sub channel carrying every normalized tick. */
export const LTP_CHANNEL = 'ltp_update';
const EMIT_INTERVAL_MS = 250; // socket broadcast throttle (single user — cheap at 4 Hz)
const DB_FLUSH_INTERVAL_MS = 10_000; // Instrument.lastPrice fallback throttle

let provider: AngelOneStream | null = null;
const timers: NodeJS.Timeout[] = [];

/** Ticks accumulated since the last socket emit / DB flush. */
let dirtyForEmit: LtpUpdate = {};
let dirtyForDb: LtpUpdate = {};

const handleTick = (update: LtpUpdate): void => {
  Object.assign(dirtyForEmit, update);
  Object.assign(dirtyForDb, update);

  if (redis.status !== 'ready') return;

  // Fan out to any Redis subscriber (test listeners, future candle builder).
  redis.publish(LTP_CHANNEL, JSON.stringify(update)).catch(() => {});

  const pipeline = redis.pipeline();
  const ts = Date.now();
  for (const [id, tick] of Object.entries(update)) {
    pipeline.setex(`ltp:${id}`, LTP_CACHE_TTL_SECONDS, JSON.stringify({ ...tick, ts }));
  }
  pipeline.exec().catch(() => {});
};

const emitToSockets = (): void => {
  if (!io || !Object.keys(dirtyForEmit).length) return;
  // volatile: a client that hasn't drained the previous frame skips this one —
  // at 4 Hz a slow browser must never queue stale prices.
  io.volatile.emit('ltp_update', dirtyForEmit);
  dirtyForEmit = {};
};

const flushToDatabase = async (): Promise<void> => {
  const entries = Object.entries(dirtyForDb);
  if (!entries.length) return;
  dirtyForDb = {};

  await prisma
    .$transaction(
      entries.map(([id, tick]) =>
        prisma.instrument.update({
          where: { id },
          data: { lastPrice: tick.l, volume: tick.v },
        }),
      ),
    )
    .catch((err) => logger.error(`[LtpStream]: db flush failed: ${err.message}`));
};

/**
 * Test/dev hook: feeds a tick through the exact pipeline the provider uses
 * (Redis publish + cache, socket emit, DB flush).
 */
export const injectTick = (update: LtpUpdate): void => handleTick(update);

/**
 * Subscribes extra instruments (e.g. option contracts being traded) to the
 * live feed on top of the boot-time index set. Already-subscribed tokens are
 * deduped by the provider. Returns false when the stream is offline
 * (no credentials / not started) — callers fall back to Instrument.lastPrice.
 */
export const subscribeLtp = (instruments: Instrument[]): boolean => {
  if (!provider) return false;
  provider.addInstrumentsToStream(instruments);
  return true;
};

/** Instruments of live (OPEN/PARTIAL) orders, so a restart keeps them ticking. */
const getLiveOrderInstruments = async (): Promise<Instrument[]> => {
  const orders = await prisma.order.findMany({
    where: { status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } },
    select: { instrument: true },
  });
  return [...new Map(orders.map(({ instrument }) => [instrument.id, instrument])).values()];
};

/** The whole equity universe — subscribed so live LTP flows to Redis for every
 *  scanned stock (not just the index rows). // SCALE LIMIT: mode-3 snap-quote
 *  for ~170 tokens is fine; a much larger universe should move equities to
 *  mode-1 (LTP-only) or a second connection. */
const getEquityInstruments = (): Promise<Instrument[]> =>
  prisma.instrument.findMany({ where: { instrumentType: 'EQ' } });

const startFanOut = (): void => {
  const emitTimer = setInterval(emitToSockets, EMIT_INTERVAL_MS);
  const dbTimer = setInterval(() => void flushToDatabase(), DB_FLUSH_INTERVAL_MS);
  for (const timer of [emitTimer, dbTimer]) {
    timer.unref();
    timers.push(timer);
  }
};

export const startLtpStream = async (): Promise<void> => {
  startFanOut();

  if (!hasAngelOneCredentials()) {
    logger.warn('[LtpStream]: Angel One credentials not set — stream disabled');
    return;
  }

  const indexInstruments = await getIndexInstruments();
  if (!indexInstruments.length) {
    logger.warn('[LtpStream]: no index instruments in DB — run the instrument sync first');
    return;
  }

  const equityInstruments = await getEquityInstruments();
  const liveOrderInstruments = await getLiveOrderInstruments();

  provider = new AngelOneStream(handleTick);
  provider.addInstrumentsToStream(indexInstruments);
  provider.addInstrumentsToStream(equityInstruments);
  provider.addInstrumentsToStream(liveOrderInstruments);
  await provider.startStream();

  logger.info(
    `[LtpStream]: started — ${indexInstruments.length} index + ${equityInstruments.length} equity + ` +
      `${liveOrderInstruments.length} live-order instruments subscribed`,
  );
};

export const stopLtpStream = async (): Promise<void> => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  await provider?.stopStream();
  provider = null;
};
