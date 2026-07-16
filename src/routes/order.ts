import { Router } from 'express';
import { z } from 'zod';

import { Broker, OrderStatus } from '@generated/prisma/enums';
import { enqueueOrder, getValidBrokerToken, ORDER_QUEUES } from '@/orders';
import { prisma } from '@services/prisma';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

const router = Router();

const placeOrderSchema = z
  .object({
    instrumentId: z.string().min(1),
    transactionType: z.enum(['BUY', 'SELL']),
    orderType: z.enum(['MARKET', 'LIMIT']),
    quantity: z.coerce.number().int().positive(),
    price: z.coerce.number().positive().optional(),
    productType: z.enum(['INTRADAY', 'NORMAL']).default('INTRADAY'),
  })
  .refine((o) => o.orderType === 'MARKET' || o.price != null, {
    message: 'price is required for LIMIT orders',
    path: ['price'],
  });

/** Place an order: persisted as PENDING, routed to the broker via the queue. */
router.post('/', async (req, res) => {
  const body = placeOrderSchema.parse(req.body);
  const userId = req.user!.id;

  const instrument = await prisma.instrument.findUnique({ where: { id: body.instrumentId } });
  if (!instrument) throw new NotFoundError('Instrument not found');

  if (body.quantity % instrument.lotSize !== 0)
    throw new BadRequestError(`quantity must be a multiple of the lot size (${instrument.lotSize})`);
  if (instrument.freezeQty > 0 && body.quantity > instrument.freezeQty)
    throw new BadRequestError(`quantity exceeds the freeze quantity (${instrument.freezeQty})`);

  // Fail fast at the API instead of a queued rejection. Broker defaults to
  // PAPER (the only registered broker) via the schema default.
  const token = await getValidBrokerToken(userId, Broker.PAPER);
  if (!token) throw new BadRequestError('Login to the broker first');

  const order = await prisma.order.create({
    data: {
      userId,
      instrumentId: body.instrumentId,
      transactionType: body.transactionType,
      orderType: body.orderType,
      productType: body.productType,
      quantity: body.quantity,
      price: body.price ?? 0,
      // MARKET orders join the price chase; a user-priced LIMIT is respected.
      chase: body.orderType === 'MARKET',
    },
    include: { instrument: true },
  });

  enqueueOrder(ORDER_QUEUES.PLACEMENT, order.id);
  res.status(201).json(order);
});

const modifyOrderSchema = z
  .object({
    price: z.coerce.number().positive().optional(),
    quantity: z.coerce.number().int().positive().optional(),
  })
  .refine((o) => o.price != null || o.quantity != null, {
    message: 'at least one of price or quantity is required',
  });

/** Modify an OPEN order. The outcome (fill or no-op) arrives async via socket. */
router.patch('/:id', async (req, res) => {
  const body = modifyOrderSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new NotFoundError('Order not found');
  if (order.status !== OrderStatus.OPEN)
    throw new ConflictError(`Only OPEN orders can be modified (order is ${order.status})`);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      ...(body.price != null ? { price: body.price } : {}),
      ...(body.quantity != null ? { quantity: body.quantity } : {}),
    },
    include: { instrument: true },
  });

  enqueueOrder(ORDER_QUEUES.MODIFICATION, order.id);
  res.json(updated);
});

/** Manual status reconciliation (hedged force_recheck parity). */
router.post('/:id/recheck', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new NotFoundError('Order not found');

  enqueueOrder(ORDER_QUEUES.STATUS, order.id);
  res.status(202).json({ message: 'Status check requested' });
});

/** Request cancellation of an OPEN order. */
router.post('/:id/cancel', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new NotFoundError('Order not found');
  // PENDING cancels race with placement — out of scope; retry once it's OPEN.
  if (order.status !== OrderStatus.OPEN)
    throw new ConflictError(`Only OPEN orders can be cancelled (order is ${order.status})`);

  enqueueOrder(ORDER_QUEUES.CANCELLATION, order.id);
  res.status(202).json({ message: 'Cancellation requested' });
});

const listOrdersSchema = z.object({
  status: z
    .enum(['PENDING', 'OPEN', 'PARTIAL', 'COMPLETED', 'CANCELLED', 'REJECTED'])
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

router.get('/', async (req, res) => {
  const { status, limit } = listOrdersSchema.parse(req.query);

  const orders = await prisma.order.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { instrument: true },
  });

  res.json(orders);
});

router.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      instrument: true,
      brokerLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!order) throw new NotFoundError('Order not found');

  res.json(order);
});

export default router;
