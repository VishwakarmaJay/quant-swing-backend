import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { subscribeLtp } from '@/ltpStream/ltpStream';
import { syncInstrumentMaster } from '@services/instrumentMaster';
import { prisma } from '@services/prisma';
import { NotFoundError } from '@utils/errors';

const router = Router();

const handleSync = async (_req: Request, res: Response) => {
  const update = await syncInstrumentMaster('system');
  res.json(update);
};

// GET supported alongside POST so the sync can be triggered from a browser.
router.get('/sync', handleSync);
router.post('/sync', handleSync);

const searchSchema = z.object({
  q: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  instrumentType: z.enum(['OPTIDX', 'AMXIDX']).optional(),
  expiry: z.iso.date().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/** Search instruments by symbol/underlying/type/expiry. */
router.get('/search', async (req, res) => {
  const { q, name, instrumentType, expiry, limit } = searchSchema.parse(req.query);

  // Tokenize the query into letter/digit runs and AND-match each as a
  // substring, so `nifty17`, `nifty 17000` and `nifty 21400 ce` all match a
  // symbol like NIFTY14JUL2621400PE (a single contiguous match would fail
  // because the strike/side aren't adjacent to the underlying name).
  const tokens = q ? (q.match(/[a-z]+|[0-9]+/gi) ?? []) : [];

  const instruments = await prisma.instrument.findMany({
    where: {
      ...(tokens.length
        ? { AND: tokens.map((token) => ({ symbol: { contains: token, mode: 'insensitive' } })) }
        : {}),
      ...(name ? { name } : {}),
      ...(instrumentType ? { instrumentType } : {}),
      ...(expiry ? { expiry: new Date(expiry) } : {}),
    },
    orderBy: [{ expiry: 'asc' }, { strike: 'asc' }],
    take: limit,
  });

  res.json(instruments);
});

const expiriesSchema = z.object({
  name: z.string().min(1),
});

/** Distinct upcoming expiries for an underlying. */
router.get('/expiries', async (req, res) => {
  const { name } = expiriesSchema.parse(req.query);

  const expiries = await prisma.instrument.findMany({
    where: { name, instrumentType: 'OPTIDX', expiry: { gte: new Date() } },
    select: { expiry: true },
    distinct: ['expiry'],
    orderBy: { expiry: 'asc' },
  });

  res.json(expiries.map((e) => e.expiry));
});

const subscribeSchema = z.object({
  instrumentId: z.string().min(1),
});

/**
 * Adds an instrument to the live LTP feed (e.g. when picked in the order
 * ticket) so ticks flow before an order is even placed. Idempotent.
 */
router.post('/subscribe', async (req, res) => {
  const { instrumentId } = subscribeSchema.parse(req.body);

  const instrument = await prisma.instrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) throw new NotFoundError('Instrument not found');

  const subscribed = subscribeLtp([instrument]);
  res.json({
    subscribed,
    message: subscribed
      ? 'Subscribed to live LTP'
      : 'LTP stream offline — using last stored price',
  });
});

export default router;
