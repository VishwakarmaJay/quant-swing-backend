import { env } from '@config/env';
import { getAngelOneSession, invalidateAngelOneSession } from '@services/angelOne';
import logger from '@services/logger';
import { ServiceUnavailableError } from '@utils/errors';

/**
 * Angel One historical candle client (getCandleData). Separate from the live
 * LTP WebSocket stream: this pulls daily OHLCV *history* over REST, the
 * foundation the factor layer reads from. Session-aware (reuses the cached
 * broker session, forces a fresh login once on an auth failure) and paced by
 * the caller to respect the ~3 req/sec historical limit.
 */

const CANDLE_URL =
  'https://apiconnect.angelbroking.com/rest/secure/angelbroking/historical/v1/getCandleData';

/** Angel One candle intervals we use. Only ONE_DAY today (daily factors). */
export type CandleInterval = 'ONE_DAY';

/** One normalized daily candle. `tradeDate` is an ISO date (YYYY-MM-DD, IST). */
export type Candle = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleRequest = {
  /** Angel exchange code — maps directly from Instrument.exchSeg (NSE/BSE/NFO/BFO). */
  exchange: string;
  /** Angel instrument token (Instrument.token). */
  symbolToken: string;
  interval: CandleInterval;
  /** Inclusive range, Angel format "YYYY-MM-DD HH:mm" in IST. */
  fromDate: string;
  toDate: string;
};

/** Angel's raw row: [timestampISO, open, high, low, close, volume]. */
type RawCandle = [string, number, number, number, number, number];

type CandleResponse = {
  status?: boolean;
  message?: string;
  errorcode?: string;
  data?: RawCandle[] | null;
};

const buildHeaders = (jwtToken: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${jwtToken}`,
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': '127.0.0.1',
  'X-MACAddress': '00:00:00:00:00:00',
  'X-PrivateKey': env.ANGELONE_API_KEY!,
});

const parseRow = (row: RawCandle): Candle => ({
  // "2026-01-15T09:15:00+05:30" -> "2026-01-15" (IST date portion).
  tradeDate: row[0].slice(0, 10),
  open: row[1],
  high: row[2],
  low: row[3],
  close: row[4],
  volume: row[5],
});

const request = async (req: CandleRequest, jwtToken: string): Promise<Response> =>
  fetch(CANDLE_URL, {
    method: 'POST',
    headers: buildHeaders(jwtToken),
    body: JSON.stringify({
      exchange: req.exchange,
      symboltoken: req.symbolToken,
      interval: req.interval,
      fromdate: req.fromDate,
      todate: req.toDate,
    }),
  });

/**
 * Fetches daily candles for one instrument over a date range. Throws
 * ServiceUnavailableError on a broker/network failure (the caller decides
 * whether one instrument's failure should abort a whole backfill).
 */
export const fetchCandles = async (req: CandleRequest): Promise<Candle[]> => {
  let session = await getAngelOneSession();
  let response = await request(req, session.jwtToken);

  // 401/403 usually means the cached JWT expired — refresh once and retry.
  if (response.status === 401 || response.status === 403) {
    logger.warn('[Candles]: auth rejected, refreshing broker session and retrying');
    await invalidateAngelOneSession();
    session = await getAngelOneSession();
    response = await request(req, session.jwtToken);
  }

  const body = (await response.json().catch(() => null)) as CandleResponse | null;

  if (!response.ok || !body?.status) {
    throw new ServiceUnavailableError(
      `getCandleData failed for ${req.exchange}:${req.symbolToken}: ${
        body?.message ?? `status ${response.status}`
      }`,
    );
  }

  const rows = body.data ?? [];
  return rows.map(parseRow);
};
