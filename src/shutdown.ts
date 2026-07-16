import type { Server } from 'node:http';

import logger from '@services/logger';
import { prisma } from '@services/prisma';
import { closeRabbit } from '@services/rabbit';
import { stopCrons } from '@/crons';
import { stopLtpStream } from '@/ltpStream/ltpStream';
import { stopOrderChasePoller, stopOrderStatusPoller } from '@/orders';
import { stopPositionCleanupPoller, stopPositionMtmPoller } from '@/positions';
import { closeSocketServer } from '@/socket/connection';

let ready = false;
let draining = false;

export const markReady = () => {
  ready = true;
};

export const markDraining = () => {
  draining = true;
  ready = false;
};

export const isReady = () => ready && !draining;

export const isDraining = () => draining;

const SHUTDOWN_BUDGET_MS = 45_000;
const DRAIN_GRACE_MS = 3_000;
let shuttingDown = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const gracefulShutdown = async (server: Server, signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[Shutdown]: received ${signal}, draining (budget ${SHUTDOWN_BUDGET_MS}ms)`);

  const force = setTimeout(() => {
    logger.error('[Shutdown]: budget exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_BUDGET_MS);
  force.unref();

  try {
    markDraining();
    logger.info('[Shutdown]: marked draining');

    await sleep(DRAIN_GRACE_MS);

    await stopLtpStream();
    logger.info('Shutdown >> ltp stream stopped');

    await closeSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('Shutdown >> http closed');

    // Stop producing new queue work before closing Rabbit; in-flight consumer
    // handlers ack/nack inside try/catch, and an unacked message simply
    // redelivers on next boot where the idempotency guards absorb it.
    stopOrderStatusPoller();
    stopOrderChasePoller();
    stopPositionMtmPoller();
    stopPositionCleanupPoller();
    stopCrons();
    await closeRabbit();
    logger.info('Shutdown >> rabbit closed');

    await prisma.$disconnect();
    logger.info('Shutdown >> database disconnected');

    clearTimeout(force);
    process.exit(0);
  } catch (err) {
    logger.error('[Shutdown]: error during drain', err);
    clearTimeout(force);
    process.exit(1);
  }
};
