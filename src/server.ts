import { createServer } from 'node:http';

import { app } from '@/app';
import { env } from '@config/env';
import logger from '@services/logger';
import { gracefulShutdown, markReady } from '@/shutdown';

import { prisma } from '@services/prisma';
import { redis } from '@services/redis';
import { connectRabbit } from '@services/rabbit';
import { startCrons } from '@/crons';
import { startLtpStream } from '@/ltpStream/ltpStream';
import { startOrderChasePoller, startOrderQueues, startOrderStatusPoller } from '@/orders';
import { startPositionCleanupPoller, startPositionMtmPoller } from '@/positions';
import { startSocketServer } from '@/socket/connection';

const server = createServer(app);

const bootstrap = async () => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  logger.info('Database connection established');

  // The shared client is lazyConnect — connect explicitly so status-guarded
  // writers (LTP cache) work from the first tick.
  if (redis.status === 'wait') await redis.connect();
  await redis.ping();
  logger.info('Redis connection established');

  await connectRabbit();
  await startCrons();
  await startOrderQueues();
  startOrderStatusPoller();
  startOrderChasePoller();
  startPositionMtmPoller();
  startPositionCleanupPoller();

  startSocketServer(server);
  // Fire-and-forget: a broker outage must not block boot.
  startLtpStream().catch((error) => logger.error('Error starting LTP stream:', error));

  server.listen(env.PORT, () => {
    markReady();
    logger.info(`Started ${env.NODE_ENV} server on port ${env.PORT}`);
  });
};

bootstrap().catch((error) => {
  logger.error('Error during boot:', error);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
