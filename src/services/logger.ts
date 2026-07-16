import winston from 'winston';

import { env, isProduction } from '@config/env';

const defaultLevel =
  env.NODE_ENV === 'production' ? 'info'
  : env.NODE_ENV === 'test' ? 'error'
  : 'debug';

const logger = winston.createLogger({
  level: env.LOG_LEVEL ?? defaultLevel,
  exitOnError: false,
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    isProduction ? winston.format.json() : winston.format.simple(),
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
