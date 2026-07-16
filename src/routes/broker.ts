import dayjs from 'dayjs';
import { Router } from 'express';

import {
  paperConfigPatchSchema,
  DEFAULT_PAPER_CONFIG,
  getBroker,
  resolvePaperConfig,
} from '@/brokers';
import type { Prisma } from '@generated/prisma/client';
import { Broker } from '@generated/prisma/enums';
import { getValidBrokerToken } from '@/orders';
import { prisma } from '@services/prisma';
import { NotFoundError } from '@utils/errors';

const router = Router();

/**
 * Paper "login" — never fails (hedged parity). Mints a dummy token valid until
 * end of day and seeds the default paper config in `meta`. Each login creates
 * a fresh row; lookups always take the latest non-expired token.
 */
router.post('/paper/login', async (req, res) => {
  const userId = req.user!.id;

  const token = await prisma.brokerToken.create({
    data: {
      userId,
      broker: Broker.PAPER,
      token: `paper-${userId}-${Date.now()}`,
      expiry: dayjs().endOf('day').toDate(),
      meta: {
        clientId: `PAPER-${userId.slice(0, 8)}`,
        name: 'Paper Test User',
        paperConfig: DEFAULT_PAPER_CONFIG,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  const availableFunds = await getBroker(Broker.PAPER).getAvailableFunds(token);
  res.json({ message: 'Login successful', expiry: token.expiry, availableFunds });
});

/** Effective (clamped/merged) paper config from the latest valid token. */
router.get('/paper/config', async (req, res) => {
  const token = await getValidBrokerToken(req.user!.id, Broker.PAPER);
  if (!token) throw new NotFoundError('No valid Paper session — login first');

  res.json(resolvePaperConfig(token));
});

/**
 * Tune the paper knobs (failRate/errorRate/delayMs/fillRate/minFillAgeMs) at
 * runtime. Takes effect on the next broker call — the token is refetched per
 * queue job.
 */
router.patch('/paper/config', async (req, res) => {
  const patch = paperConfigPatchSchema.parse(req.body);

  const token = await getValidBrokerToken(req.user!.id, Broker.PAPER);
  if (!token) throw new NotFoundError('No valid Paper session — login first');

  const meta = (token.meta ?? {}) as Record<string, unknown>;
  const current = (meta.paperConfig ?? {}) as Record<string, Record<string, number>>;
  const merged = { ...current };
  for (const [segment, values] of Object.entries(patch)) {
    if (!values) continue;
    merged[segment] = { ...current[segment], ...values };
  }

  const updated = await prisma.brokerToken.update({
    where: { id: token.id },
    data: { meta: { ...meta, paperConfig: merged } as Prisma.InputJsonValue },
  });

  res.json(resolvePaperConfig(updated));
});

/** Simulated available funds (10 crore or 3 lakh at random). */
router.get('/paper/funds', async (req, res) => {
  const token = await getValidBrokerToken(req.user!.id, Broker.PAPER);
  if (!token) throw new NotFoundError('No valid Paper session — login first');

  const availableFunds = await getBroker(Broker.PAPER).getAvailableFunds(token);
  res.json({ availableFunds });
});

export default router;
