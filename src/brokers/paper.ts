import { z } from 'zod';

import type { BrokerToken, Prisma } from '@generated/prisma/client';
import { Broker, OrderStatus } from '@generated/prisma/enums';
import { LiveLtp } from '@/ltpStream/liveLtp';
import logger from '@services/logger';
import { prisma } from '@services/prisma';

import type { BrokerService, OrderUpdate, OrderWithInstrument } from './types';

/**
 * Paper — a test/simulation broker (ported from hedged-core-backend).
 *
 * It does NOT talk to any external API. Every method fabricates a randomized
 * outcome so the rest of the order pipeline (queues, poller, sockets) can be
 * exercised end-to-end without a live broker account.
 *
 * Behaviour is driven by a per-token config stored at `BrokerToken.meta.paperConfig`,
 * seeded with DEFAULT_PAPER_CONFIG at login (src/routes/broker.ts) and editable
 * afterwards via PATCH /broker/paper/config. The token is refetched per queue
 * job, so edits take effect on the next broker call. A missing, partial or
 * malformed config falls back to the code defaults field-by-field.
 *
 * The config has four segments — placement, modification, cancellation,
 * orderStatus — each with:
 *  - delayMs:   simulated API latency (the method sleeps this long)
 *  - failRate:  probability [0,1] of a "domain" failure (successful API
 *               response, negative result): placement -> REJECTED,
 *               modification/cancellation -> stays OPEN, orderStatus -> REJECTED
 *  - errorRate: probability [0,1] of a "hard" failure (throws, simulating a
 *               broker/network error). Evaluated before failRate.
 * orderStatus additionally has:
 *  - fillRate:     probability an eligible OPEN order fills on a status check
 *  - minFillAgeMs: min age since placedAt before an OPEN order may fill (so it
 *                  never completes on the first post-placement poll)
 *
 * Fills execute at the live LTP (Redis cache) when available, falling back to
 * `instrument.lastPrice`, then the order's own limit price.
 *
 * Funds are not one of the four segments: 10 crore or 3 lakh at random per call.
 */

export interface PaperSegmentConfig {
  delayMs: number;
  failRate: number;
  errorRate: number;
}

export interface PaperOrderStatusConfig extends PaperSegmentConfig {
  fillRate: number;
  minFillAgeMs: number;
}

export interface PaperConfig {
  placement: PaperSegmentConfig;
  modification: PaperSegmentConfig;
  cancellation: PaperSegmentConfig;
  orderStatus: PaperOrderStatusConfig;
}

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  placement: { delayMs: 0, failRate: 0.3, errorRate: 0 },
  modification: { delayMs: 0, failRate: 0, errorRate: 0 },
  cancellation: { delayMs: 0, failRate: 0, errorRate: 0 },
  orderStatus: { delayMs: 0, failRate: 0, errorRate: 0, fillRate: 0.6, minFillAgeMs: 8_000 },
};

const segmentPatch = z.object({
  delayMs: z.number().min(0).optional(),
  failRate: z.number().min(0).max(1).optional(),
  errorRate: z.number().min(0).max(1).optional(),
});

/** Deep-partial patch accepted by PATCH /broker/paper/config. */
export const paperConfigPatchSchema = z.object({
  placement: segmentPatch.optional(),
  modification: segmentPatch.optional(),
  cancellation: segmentPatch.optional(),
  orderStatus: segmentPatch
    .extend({
      fillRate: z.number().min(0).max(1).optional(),
      minFillAgeMs: z.number().min(0).optional(),
    })
    .optional(),
});

// Funds returned at login / on getAvailableFunds.
const FUNDS_HIGH = 100_000_000; // 10 crore
const FUNDS_LOW = 300_000; // 3 lakh

export const randomPaperFunds = (): number => (Math.random() < 0.5 ? FUNDS_HIGH : FUNDS_LOW);

// Coerce an arbitrary stored value into a probability in [0,1], else fall back.
const rate = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

// Coerce an arbitrary stored value into a non-negative number (ms), else fall back.
const nonNegative = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

/**
 * Merge a stored paperConfig (if any) over the code defaults, field-by-field,
 * validating and clamping every value so a malformed config can never break
 * the broker. Exported so the config routes can show effective values.
 */
export const resolvePaperConfig = (token: BrokerToken): PaperConfig => {
  const meta = (token.meta ?? {}) as { paperConfig?: Partial<PaperConfig> };
  const stored = meta.paperConfig ?? {};
  const d = DEFAULT_PAPER_CONFIG;

  const segment = (
    s: Partial<PaperSegmentConfig> | undefined,
    def: PaperSegmentConfig,
  ): PaperSegmentConfig => ({
    delayMs: nonNegative(s?.delayMs, def.delayMs),
    failRate: rate(s?.failRate, def.failRate),
    errorRate: rate(s?.errorRate, def.errorRate),
  });

  return {
    placement: segment(stored.placement, d.placement),
    modification: segment(stored.modification, d.modification),
    cancellation: segment(stored.cancellation, d.cancellation),
    orderStatus: {
      ...segment(stored.orderStatus, d.orderStatus),
      fillRate: rate(stored.orderStatus?.fillRate, d.orderStatus.fillRate),
      minFillAgeMs: nonNegative(stored.orderStatus?.minFillAgeMs, d.orderStatus.minFillAgeMs),
    },
  };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Paper implements BrokerService {
  private static _instance: Paper;

  public readonly broker = Broker.PAPER;
  private readonly baseUrl: string = 'https://paper.test.broker/';

  private constructor() {}

  static getInstance(): Paper {
    if (!Paper._instance) Paper._instance = new Paper();
    return Paper._instance;
  }

  /**
   * Writes a BrokerLog row mirroring what a real API broker would persist, so
   * order flows stay reconstructable against Paper too. A log failure must
   * never fail the broker call.
   */
  private async log(
    order: OrderWithInstrument | undefined,
    args: { method: string; url: string; response: unknown; isError?: boolean; statusCode?: number },
    userId: string,
  ): Promise<void> {
    try {
      await prisma.brokerLog.create({
        data: {
          broker: this.broker,
          method: args.method,
          url: this.baseUrl + args.url,
          request: order
            ? {
                symbol: order.instrument.symbol,
                transactionType: order.transactionType,
                quantity: order.quantity,
                price: order.price,
                orderType: order.orderType,
              }
            : {},
          response: args.response as Prisma.InputJsonValue,
          isError: args.isError ?? false,
          statusCode: args.statusCode ?? 200,
          duration: 1,
          orderId: order?.id,
          brokerOrderId: order?.brokerOrderId ?? undefined,
          userId,
        },
      });
    } catch (error) {
      logger.error('[Paper]: failed to write BrokerLog', error);
    }
  }

  /**
   * Simulate a hard API/network error: log it and throw. Evaluated before any
   * domain logic.
   */
  private async maybeThrow(
    segment: string,
    errorRate: number,
    order: OrderWithInstrument | undefined,
    userId: string,
    url: string,
    method: string,
  ): Promise<void> {
    if (Math.random() >= errorRate) return;
    await this.log(
      order,
      {
        method,
        url,
        response: { error: `Paper ${segment} simulated error` },
        isError: true,
        statusCode: 500,
      },
      userId,
    );
    throw new Error(`Paper ${segment} simulated error`);
  }

  /** Live LTP -> instrument.lastPrice -> order limit price. */
  private async fillPrice(order: OrderWithInstrument): Promise<number> {
    const quote = await LiveLtp.get(order.instrumentId);
    return quote?.l ?? (order.instrument.lastPrice || order.price);
  }

  public async getAvailableFunds(token: BrokerToken): Promise<number> {
    const funds = randomPaperFunds();
    await this.log(undefined, { method: 'GET', url: 'funds', response: { funds } }, token.userId);
    return funds;
  }

  public async placeOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate> {
    const cfg = resolvePaperConfig(token).placement;
    await sleep(cfg.delayMs);
    await this.maybeThrow('placement', cfg.errorRate, order, token.userId, 'place-order', 'POST');

    const update: OrderUpdate =
      Math.random() < cfg.failRate
        ? { status: OrderStatus.REJECTED, rejectReason: 'Paper broker simulated rejection' }
        : // Success: only accepted placements get a broker order id attached.
          { status: OrderStatus.OPEN, brokerOrderId: `PAPER-${order.id}` };

    await this.log(
      { ...order, ...update },
      {
        method: 'POST',
        url: 'place-order',
        response: {
          orderId: update.brokerOrderId,
          status: update.status,
          rejectReason: update.rejectReason,
        },
        isError: update.status === OrderStatus.REJECTED,
      },
      token.userId,
    );

    return update;
  }

  public async modifyOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate> {
    const cfg = resolvePaperConfig(token).modification;
    await sleep(cfg.delayMs);
    await this.maybeThrow('modification', cfg.errorRate, order, token.userId, 'modify-order', 'PUT');

    // Domain failure: the modify "succeeds" at the API level but the order is
    // not filled — stays as-is.
    const modified = Math.random() >= cfg.failRate;
    const update: OrderUpdate = modified
      ? {
          status: OrderStatus.COMPLETED,
          filledQuantity: order.quantity,
          averageExecutionPrice: await this.fillPrice(order),
          executedAt: new Date(),
        }
      : { status: order.status };

    await this.log(
      order,
      {
        method: 'PUT',
        url: 'modify-order',
        response: { orderId: order.brokerOrderId, status: update.status, modified },
      },
      token.userId,
    );

    return update;
  }

  public async cancelOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate> {
    const cfg = resolvePaperConfig(token).cancellation;
    await sleep(cfg.delayMs);
    await this.maybeThrow('cancellation', cfg.errorRate, order, token.userId, 'cancel-order', 'DELETE');

    // Domain failure: the cancel "succeeds" at the API level but the order is
    // not cancelled — stays as-is.
    const cancelled = Math.random() >= cfg.failRate;
    const update: OrderUpdate = cancelled
      ? { status: OrderStatus.CANCELLED, cancelledAt: new Date() }
      : { status: order.status };

    await this.log(
      order,
      {
        method: 'DELETE',
        url: 'cancel-order',
        response: { orderId: order.brokerOrderId, status: update.status, cancelled },
      },
      token.userId,
    );

    return update;
  }

  public async getOrderStatus(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate> {
    const cfg = resolvePaperConfig(token).orderStatus;
    await sleep(cfg.delayMs);
    await this.maybeThrow('orderStatus', cfg.errorRate, order, token.userId, 'order-status', 'GET');

    // Refetch the authoritative status so a status check NEVER overrides a
    // terminal status that a MODIFY (-> COMPLETED) or CANCEL (-> CANCELLED)
    // may have just persisted. We only ever advance a still-OPEN order.
    const latest = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, placedAt: true },
    });
    const currentStatus = latest?.status ?? order.status;

    if (currentStatus !== OrderStatus.OPEN) {
      await this.log(
        order,
        { method: 'GET', url: 'order-status', response: { status: currentStatus, terminal: true } },
        token.userId,
      );
      return { status: currentStatus };
    }

    // An order is only eligible to fill once it has been live for more than
    // minFillAgeMs, so it never completes on the first post-placement poll.
    const placedAt = latest?.placedAt ?? order.placedAt;
    const ageMs = placedAt ? Date.now() - placedAt.getTime() : 0;
    if (ageMs <= cfg.minFillAgeMs) {
      await this.log(
        order,
        { method: 'GET', url: 'order-status', response: { status: OrderStatus.OPEN, ageMs } },
        token.userId,
      );
      return { status: OrderStatus.OPEN };
    }

    let update: OrderUpdate;
    let response: unknown;
    if (Math.random() < cfg.failRate) {
      update = { status: OrderStatus.REJECTED, rejectReason: 'Paper broker simulated rejection' };
      response = { status: update.status };
    } else if (Math.random() < cfg.fillRate) {
      update = {
        status: OrderStatus.COMPLETED,
        filledQuantity: order.quantity,
        averageExecutionPrice: await this.fillPrice(order),
        executedAt: new Date(),
      };
      response = { status: update.status, filled: order.quantity };
    } else {
      update = { status: OrderStatus.OPEN };
      response = { status: update.status };
    }

    await this.log(
      order,
      {
        method: 'GET',
        url: 'order-status',
        response,
        isError: update.status === OrderStatus.REJECTED,
      },
      token.userId,
    );

    return update;
  }
}
