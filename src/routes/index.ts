import { Router } from 'express';

import { isDraining, isReady } from '@/shutdown';

const router = Router();

/** Liveness/readiness flag check (used by the load balancer). */
router.get('/health-check', (_req, res) => {
  if (isDraining()) {
    res.status(503).send('Draining');
    return;
  }
  if (!isReady()) {
    res.status(503).send('Not Ready');
    return;
  }
  res.status(200).send('Healthy');
});

/** Browsers request this automatically; answer empty so it never hits the auth guard. */
router.get('/favicon.ico', (_req, res) => res.status(204).end());

export default router;
