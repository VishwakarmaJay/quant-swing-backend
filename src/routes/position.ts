import { Router } from 'express';
import { z } from 'zod';

import { Broker, OrderStatus, PositionStatus, TradeSetupStatus } from '@generated/prisma/enums';
import { enqueueOrder, getValidBrokerToken, ORDER_QUEUES } from '@/orders';
import { sortOrders, syncPosition } from '@/positions';
import { io } from '@/socket/connection';
import { prisma } from '@services/prisma';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import { isTradingAllowed } from '@utils/marketHours';

const router = Router();

const positionInclude = {
  tradeSetup: true,
  legs: {
    include: {
      tradeSetupLeg: true,
      instrument: true,
      orders: { orderBy: { createdAt: 'desc' as const } },
    },
  },
} as const;

const LIVE_ORDER_STATUSES = [OrderStatus.PENDING, OrderStatus.OPEN, OrderStatus.PARTIAL];

const createSchema = z.object({
  tradeSetupId: z.string().min(1),
  userMultiplier: z.coerce.number().int().positive().max(100).default(1),
});

/** Take a position on a trade setup (hedged create_draft_position, trimmed). */
router.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const userId = req.user!.id;

  const setup = await prisma.tradeSetup.findUnique({
    where: { id: body.tradeSetupId },
    include: { legs: true },
  });
  if (!setup) throw new NotFoundError('Trade setup not found');
  if (setup.status !== TradeSetupStatus.ACTIVE)
    throw new BadRequestError('Trade setup is archived');
  if (!setup.legs.length) throw new BadRequestError('Trade setup has no legs');

  const token = await getValidBrokerToken(userId, Broker.PAPER);
  if (!token) throw new BadRequestError('Login to the broker first');

  // One live position per setup (hedged rule); an exiting position blocks
  // until its orders settle.
  const existing = await prisma.position.findFirst({
    where: { tradeSetupId: setup.id, status: { not: PositionStatus.CLOSED } },
    include: { orders: { where: { status: { in: LIVE_ORDER_STATUSES } }, select: { id: true } } },
  });
  if (existing) {
    if (existing.status !== PositionStatus.MARKED_FOR_EXIT)
      throw new ConflictError(
        'A live position already exists for this setup — update its multiplier instead',
      );
    if (existing.orders.length)
      throw new ConflictError('The previous position is still squaring off — try again shortly');
  }

  const position = await prisma.position.create({
    data: {
      userId,
      tradeSetupId: setup.id,
      userMultiplier: body.userMultiplier,
      legs: {
        create: setup.legs.map((leg) => ({
          tradeSetupLegId: leg.id,
          instrumentId: leg.instrumentId,
          action: leg.action,
          userId,
        })),
      },
    },
    include: positionInclude,
  });

  res.status(201).json(position);
});

const listSchema = z.object({
  status: z.enum(['OPEN', 'MARKED_FOR_EXIT', 'CLOSED']).optional(),
});

router.get('/', async (req, res) => {
  const { status } = listSchema.parse(req.query);

  const positions = await prisma.position.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    include: positionInclude,
  });

  res.json(positions);
});

router.get('/:id', async (req, res) => {
  const position = await prisma.position.findUnique({
    where: { id: req.params.id },
    include: positionInclude,
  });
  if (!position) throw new NotFoundError('Position not found');
  res.json(position);
});

const patchSchema = z
  .object({
    status: z.literal('MARKED_FOR_EXIT').optional(),
    userMultiplier: z.coerce.number().int().positive().max(100).optional(),
  })
  .refine((o) => o.status != null || o.userMultiplier != null, {
    message: 'status or userMultiplier is required',
  });

/** Exit trigger (MARKED_FOR_EXIT) and multiplier change (hedged update_position). */
router.patch('/:id', async (req, res) => {
  const body = patchSchema.parse(req.body);

  const position = await prisma.position.findUnique({ where: { id: req.params.id } });
  if (!position) throw new NotFoundError('Position not found');
  if (position.status === PositionStatus.CLOSED)
    throw new ConflictError('Position is closed');
  if (body.userMultiplier != null && position.status === PositionStatus.MARKED_FOR_EXIT)
    throw new ConflictError('Cannot change the multiplier of an exiting position');

  const updated = await prisma.position.update({
    where: { id: position.id },
    data: {
      ...(body.status ? { status: PositionStatus.MARKED_FOR_EXIT } : {}),
      ...(body.userMultiplier != null ? { userMultiplier: body.userMultiplier } : {}),
    },
    include: positionInclude,
  });

  // Target changed — recompute readableStatus + notify.
  await syncPosition(position.id);
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const position = await prisma.position.findUnique({
    where: { id: req.params.id },
    include: { orders: { where: { status: { in: LIVE_ORDER_STATUSES } }, select: { id: true } } },
  });
  if (!position) throw new NotFoundError('Position not found');
  if (position.orders.length)
    throw new ConflictError('Cannot delete a position with live orders');

  await prisma.$transaction([
    prisma.order.deleteMany({ where: { positionId: position.id } }),
    prisma.positionLeg.deleteMany({ where: { positionId: position.id } }),
    prisma.position.delete({ where: { id: position.id } }),
  ]);

  res.json({ message: 'Position deleted' });
});

const placeOrdersSchema = z.object({
  orders: z
    .array(
      z.object({
        /** Present → modify this OPEN order instead of creating a new one */
        id: z.string().optional(),
        positionLegId: z.string().min(1),
        transactionType: z.enum(['BUY', 'SELL']),
        orderType: z.enum(['MARKET', 'LIMIT']),
        quantity: z.coerce.number().int().positive(),
        price: z.coerce.number().positive().optional(),
        productType: z.enum(['INTRADAY', 'NORMAL']).default('INTRADAY'),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * The legacy place_order port: the client computes the diff orders from the
 * position's legs (syncOrder/exitPosition) and posts them as a batch. Orders
 * carrying an `id` modify an existing OPEN order; the rest are created and
 * placed, risk-sorted (exits/hedges first).
 */
router.post('/:id/orders', async (req, res) => {
  const body = placeOrdersSchema.parse(req.body);
  const userId = req.user!.id;

  if (!isTradingAllowed())
    throw new BadRequestError('Market is closed (09:15–15:30 IST, Mon–Fri)');

  const position = await prisma.position.findUnique({
    where: { id: req.params.id },
    include: { legs: { include: { instrument: true } } },
  });
  if (!position) throw new NotFoundError('Position not found');
  if (position.status === PositionStatus.CLOSED)
    throw new ConflictError('Position is closed');

  const token = await getValidBrokerToken(userId, position.broker);
  if (!token) throw new BadRequestError('Login to the broker first');

  const legById = new Map(position.legs.map((leg) => [leg.id, leg]));
  for (const order of body.orders) {
    const leg = legById.get(order.positionLegId);
    if (!leg) throw new BadRequestError('All orders must be for legs of this position');
    if (order.quantity % leg.instrument.lotSize !== 0)
      throw new BadRequestError(
        `${leg.instrument.symbol}: quantity must be a multiple of the lot size (${leg.instrument.lotSize})`,
      );
    if (leg.instrument.freezeQty > 0 && order.quantity > leg.instrument.freezeQty)
      throw new BadRequestError(
        `${leg.instrument.symbol}: quantity exceeds the freeze quantity (${leg.instrument.freezeQty})`,
      );
    if (order.orderType === 'LIMIT' && order.price == null)
      throw new BadRequestError('price is required for LIMIT orders');
  }

  const toModify = body.orders.filter((o) => o.id);
  const toCreate = body.orders.filter((o) => !o.id);

  const persisted = await prisma.$transaction(async (tx) => {
    // Modify branch: only still-OPEN orders may be re-priced/re-sized.
    for (const order of toModify) {
      const existing = await tx.order.findFirst({
        where: { id: order.id!, positionId: position.id, status: OrderStatus.OPEN },
      });
      if (!existing)
        throw new ConflictError(`Order ${order.id} is not OPEN — refresh and retry`);
      await tx.order.update({
        where: { id: existing.id },
        data: {
          price: order.price ?? existing.price,
          quantity: order.quantity,
          orderType: order.orderType,
        },
      });
    }

    const created = await Promise.all(
      toCreate.map((order) =>
        tx.order.create({
          data: {
            userId,
            instrumentId: legById.get(order.positionLegId)!.instrumentId,
            positionId: position.id,
            positionLegId: order.positionLegId,
            broker: position.broker,
            transactionType: order.transactionType,
            orderType: order.orderType,
            productType: order.productType,
            quantity: order.quantity,
            price: order.price ?? 0,
            chase: true,
          },
        }),
      ),
    );
    return created.map((o) => o.id).concat(toModify.map((o) => o.id!));
  });

  const orders = await prisma.order.findMany({
    where: { id: { in: persisted } },
    include: { instrument: true, positionLeg: true },
  });
  const modifyIds = new Set(toModify.map((o) => o.id!));

  // Risk-aware placement order (exits/hedges first); prefetch-1 consumers
  // serialize the actual broker calls, so no artificial stagger is needed.
  const sorted = sortOrders(
    orders.filter((o) => o.positionLeg != null) as ((typeof orders)[number] & {
      positionLeg: NonNullable<(typeof orders)[number]['positionLeg']>;
    })[],
  );
  for (const order of sorted) {
    enqueueOrder(
      modifyIds.has(order.id) ? ORDER_QUEUES.MODIFICATION : ORDER_QUEUES.PLACEMENT,
      order.id,
    );
    io?.emit('order-update', order);
  }

  res.status(201).json({ orders: sorted });
});

export default router;
