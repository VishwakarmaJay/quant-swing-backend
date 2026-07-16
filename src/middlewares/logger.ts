import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import logger from '@services/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers['x-request-id'] as string | undefined) || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms [${id}]`;

    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.info(line);
  });

  next();
};
