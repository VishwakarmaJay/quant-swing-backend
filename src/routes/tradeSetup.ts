import { Router } from 'express';
import { z } from 'zod';

import { PositionStatus, TradeSetupStatus } from '@generated/prisma/enums';
import { prisma } from '@services/prisma';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

const router = Router();

const legSchema = z.object({
  instrumentId: z.string().min(1),
  action: z.enum(['BUY', 'SELL']),
  quantity: z.coerce.number().int().positive(),
  entryPrice: z.coerce.number().positive().optional(),
  exitPrice: z.coerce.number().positive().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  legs: z.array(legSchema).min(1).max(10),
});

const setupInclude = {
  legs: { include: { instrument: true } },
} as const;

/** Validate every leg's instrument exists and the quantity is a lot multiple. */
const validateLegs = async (legs: z.infer<typeof legSchema>[]) => {
  const instruments = await prisma.instrument.findMany({
    where: { id: { in: legs.map((l) => l.instrumentId) } },
  });
  const byId = new Map(instruments.map((i) => [i.id, i]));
  for (const leg of legs) {
    const instrument = byId.get(leg.instrumentId);
    if (!instrument) throw new NotFoundError(`Instrument not found: ${leg.instrumentId}`);
    if (leg.quantity % instrument.lotSize !== 0)
      throw new BadRequestError(
        `${instrument.symbol}: quantity must be a multiple of the lot size (${instrument.lotSize})`,
      );
    if (instrument.freezeQty > 0 && leg.quantity > instrument.freezeQty)
      throw new BadRequestError(
        `${instrument.symbol}: quantity exceeds the freeze quantity (${instrument.freezeQty})`,
      );
  }
};

/** How many non-CLOSED positions reference a setup (guards edits/deletes). */
const livePositionCount = (tradeSetupId: string) =>
  prisma.position.count({
    where: { tradeSetupId, status: { not: PositionStatus.CLOSED } },
  });

router.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  await validateLegs(body.legs);

  const setup = await prisma.tradeSetup.create({
    data: {
      name: body.name,
      legs: { create: body.legs },
    },
    include: setupInclude,
  });

  res.status(201).json(setup);
});

const listSchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

router.get('/', async (req, res) => {
  const { status } = listSchema.parse(req.query);

  const setups = await prisma.tradeSetup.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    include: {
      ...setupInclude,
      _count: {
        select: { positions: { where: { status: { not: PositionStatus.CLOSED } } } },
      },
    },
  });

  res.json(
    setups.map(({ _count, ...setup }) => ({ ...setup, livePositions: _count.positions })),
  );
});

router.get('/:id', async (req, res) => {
  const setup = await prisma.tradeSetup.findUnique({
    where: { id: req.params.id },
    include: setupInclude,
  });
  if (!setup) throw new NotFoundError('Trade setup not found');
  res.json(setup);
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  legs: z.array(legSchema).min(1).max(10).optional(),
});

router.patch('/:id', async (req, res) => {
  const body = patchSchema.parse(req.body);

  const setup = await prisma.tradeSetup.findUnique({ where: { id: req.params.id } });
  if (!setup) throw new NotFoundError('Trade setup not found');

  // Leg replacement changes the reconcile target — only safe with no live position.
  if (body.legs) {
    if ((await livePositionCount(setup.id)) > 0)
      throw new ConflictError('Cannot edit legs while a live position references this setup');
    await validateLegs(body.legs);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (body.legs) {
      await tx.tradeSetupLeg.deleteMany({ where: { tradeSetupId: setup.id } });
      await tx.tradeSetupLeg.createMany({
        data: body.legs.map((leg) => ({ ...leg, tradeSetupId: setup.id })),
      });
    }
    return tx.tradeSetup.update({
      where: { id: setup.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.status ? { status: body.status as TradeSetupStatus } : {}),
      },
      include: setupInclude,
    });
  });

  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const setup = await prisma.tradeSetup.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { positions: true } } },
  });
  if (!setup) throw new NotFoundError('Trade setup not found');
  if (setup._count.positions > 0)
    throw new ConflictError('Cannot delete a setup referenced by positions — archive it instead');

  await prisma.$transaction([
    prisma.tradeSetupLeg.deleteMany({ where: { tradeSetupId: setup.id } }),
    prisma.tradeSetup.delete({ where: { id: setup.id } }),
  ]);

  res.json({ message: 'Trade setup deleted' });
});

export default router;
