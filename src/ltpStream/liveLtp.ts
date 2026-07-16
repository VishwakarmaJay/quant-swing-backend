import { redis } from '@services/redis';
import type { CachedQuote } from './ltpUpdate';

const key = (instrumentId: string) => `ltp:${instrumentId}`;

const safeParse = (raw: string | null): CachedQuote | null => {
  if (!raw) return null;
  try {
    const quote = JSON.parse(raw) as CachedQuote;
    const values = [quote.l, quote.b, quote.a, quote.v, quote.ts];
    if (values.some((value) => typeof value !== 'number')) return null;
    return quote;
  } catch {
    return null;
  }
};

/**
 * Read API over the Redis LTP cache (hedged's LiveLTP semantics): best-effort,
 * contractually no-throw — returns null on miss, expiry, or Redis being down.
 * Callers fall back to `Instrument.lastPrice`.
 */
export const LiveLtp = {
  async get(instrumentId: string): Promise<CachedQuote | null> {
    if (redis.status !== 'ready') return null;
    const raw = await redis.get(key(instrumentId)).catch(() => null);
    return safeParse(raw);
  },

  async mget(instrumentIds: string[]): Promise<Record<string, CachedQuote | null>> {
    if (!instrumentIds.length) return {};
    if (redis.status !== 'ready')
      return Object.fromEntries(instrumentIds.map((id) => [id, null]));

    const raws = await redis
      .mget(instrumentIds.map(key))
      .catch(() => instrumentIds.map(() => null));
    return Object.fromEntries(instrumentIds.map((id, i) => [id, safeParse(raws[i] ?? null)]));
  },

  async getDepth(instrumentId: string): Promise<{ b: number; a: number; ts: number } | null> {
    const quote = await this.get(instrumentId);
    return quote ? { b: quote.b, a: quote.a, ts: quote.ts } : null;
  },
};
