import { env } from '@config/env';
import type { Instrument } from '@generated/prisma/client';
import { getAngelOneSession, invalidateAngelOneSession } from '@services/angelOne';
import logger from '@services/logger';
import type { LtpUpdate } from './ltpUpdate';

const WS_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 10_000;
const SNAP_QUOTE_MODE = 3; // the only mode carrying best bid/ask

/** Angel One exchangeType codes, keyed by our Instrument.exchSeg values. */
const EXCHANGE_TYPES: Record<string, number> = {
  NSE: 1,
  NFO: 2,
  BSE: 3,
  BFO: 4,
};

/** Best-five block: 10 records x 20 bytes each, starting at byte 147 (mode 3). */
const BEST_FIVE_OFFSET = 147;
const BEST_FIVE_RECORD_SIZE = 20;
const BEST_FIVE_RECORDS = 10;

export type TickHandler = (update: LtpUpdate) => void;

/**
 * Parses one SmartWebSocketV2 binary frame (little-endian) into a normalized
 * tick. Returns null for non-snap-quote or malformed frames. Exported for
 * testing.
 */
export const parseSnapQuote = (
  buffer: ArrayBuffer,
  instrumentIdByToken: Map<string, string>,
): LtpUpdate | null => {
  if (buffer.byteLength < 51) return null;
  const view = new DataView(buffer);

  const token = new TextDecoder()
    .decode(new Uint8Array(buffer, 2, 25))
    .replace(/\0+$/, '')
    .trim();
  const instrumentId = instrumentIdByToken.get(token);
  if (!instrumentId) return null;

  const ltp = Number(view.getBigInt64(43, true)) / 100;

  let volume = 0;
  if (buffer.byteLength >= 123) volume = Number(view.getBigInt64(67, true));

  let bid = 0;
  let ask = 0;
  if (buffer.byteLength >= BEST_FIVE_OFFSET + BEST_FIVE_RECORDS * BEST_FIVE_RECORD_SIZE) {
    for (let i = 0; i < BEST_FIVE_RECORDS; i++) {
      const offset = BEST_FIVE_OFFSET + i * BEST_FIVE_RECORD_SIZE;
      const isBuy = view.getInt16(offset, true) === 1;
      const price = Number(view.getBigInt64(offset + 10, true)) / 100;
      // Empty book slots carry 0 or -1 paise (e.g. indices have no depth);
      // only positive prices are real quotes.
      if (price <= 0) continue;
      if (isBuy && !bid) bid = price;
      if (!isBuy && !ask) ask = price;
      if (bid && ask) break;
    }
  }

  return {
    [instrumentId]: {
      l: ltp,
      b: bid || ltp,
      a: ask || ltp,
      v: volume,
    },
  };
};

/**
 * Angel One SmartAPI WebSocket 2.0 provider. Connects with the broker session,
 * subscribes in snap-quote mode, keeps the connection alive with a 30s `ping`,
 * reconnects with a delay on close, and re-subscribes everything on reconnect.
 */
export class AngelOneStream {
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  /** Angel One token -> our instrument id, for tick normalization. */
  private readonly instrumentIdByToken = new Map<string, string>();
  /** exchSeg -> subscribed token set, for (re)subscription. */
  private readonly tokensByExchSeg = new Map<string, Set<string>>();

  constructor(private readonly onTick: TickHandler) {}

  /** Resolves once the socket is actually open; rejects if it closes first. */
  async startStream(): Promise<void> {
    this.stopping = false;
    const session = await getAngelOneSession();

    const socket = new WebSocket(WS_URL, {
      headers: {
        Authorization: `Bearer ${session.jwtToken}`,
        'x-api-key': env.ANGELONE_API_KEY!,
        'x-client-code': env.ANGELONE_CLIENT_CODE!,
        'x-feed-token': session.feedToken,
      },
    } as unknown as string[]);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    let receivedData = false;

    return new Promise<void>((resolve, reject) => {
      let opened = false;

      socket.onopen = () => {
        opened = true;
        this.startHeartbeat();
        this.sendSubscriptions();
        logger.info('[AngelOneStream]: connected');
        resolve();
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // The broker reports auth/subscription failures as JSON text frames —
          // never swallow them.
          if (event.data !== 'pong') {
            logger.error(`[AngelOneStream]: broker error frame: ${event.data}`);
          }
          return;
        }
        receivedData = true;
        const update = parseSnapQuote(event.data as ArrayBuffer, this.instrumentIdByToken);
        if (update) this.onTick(update);
      };

      socket.onerror = () => logger.error('[AngelOneStream]: socket error');

      socket.onclose = () => {
        this.stopHeartbeat();
        if (this.stopping) return;

        if (!opened) reject(new Error('connection closed before opening'));

        if (!receivedData) {
          // Opened (or failed) without a single data frame — the classic
          // signature of an expired/invalid session. Force a fresh login on
          // the next attempt instead of reusing the cached token forever.
          logger.warn('[AngelOneStream]: closed without receiving data — refreshing broker session');
          void invalidateAngelOneSession();
        }

        logger.warn(`[AngelOneStream]: closed, reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        this.reconnectTimer = setTimeout(() => {
          this.startStream().catch((err) =>
            logger.error(`[AngelOneStream]: reconnect failed: ${err.message}`),
          );
        }, RECONNECT_DELAY_MS);
      };
    });
  }

  async stopStream(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  /** Registers instruments and subscribes any that are new. */
  addInstrumentsToStream(instruments: Instrument[]): void {
    const fresh: Instrument[] = [];

    for (const instrument of instruments) {
      const tokens = this.tokensByExchSeg.get(instrument.exchSeg) ?? new Set<string>();
      if (tokens.has(instrument.token)) continue;

      tokens.add(instrument.token);
      this.tokensByExchSeg.set(instrument.exchSeg, tokens);
      this.instrumentIdByToken.set(instrument.token, instrument.id);
      fresh.push(instrument);
    }

    if (fresh.length && this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscriptions(fresh);
    }
  }

  /** True when the instrument token is already part of the stream. */
  isSubscribed(token: string): boolean {
    return this.instrumentIdByToken.has(token);
  }

  /** Subscribes the given instruments, or everything registered when omitted. */
  private sendSubscriptions(instruments?: Instrument[]): void {
    const tokenList =
      instruments ?
        this.groupTokens(instruments)
      : [...this.tokensByExchSeg.entries()].map(([exchSeg, tokens]) => ({
          exchangeType: EXCHANGE_TYPES[exchSeg]!,
          tokens: [...tokens],
        }));

    if (!tokenList.length) return;

    this.socket?.send(
      JSON.stringify({
        correlationID: 'quant-swing',
        action: 1,
        params: { mode: SNAP_QUOTE_MODE, tokenList },
      }),
    );

    const count = tokenList.reduce((sum, group) => sum + group.tokens.length, 0);
    logger.info(`[AngelOneStream]: subscribed ${count} tokens`);
  }

  private groupTokens(instruments: Instrument[]) {
    const groups = new Map<number, string[]>();
    for (const instrument of instruments) {
      const exchangeType = EXCHANGE_TYPES[instrument.exchSeg];
      if (!exchangeType) continue;
      groups.set(exchangeType, [...(groups.get(exchangeType) ?? []), instrument.token]);
    }
    return [...groups.entries()].map(([exchangeType, tokens]) => ({ exchangeType, tokens }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('ping');
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
