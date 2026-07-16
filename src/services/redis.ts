import Redis, { type RedisOptions } from 'ioredis';

const baseOptions = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  lazyConnect: true,
  maxRetriesPerRequest: null,
} satisfies RedisOptions;

export const redis = new Redis(baseOptions);
export const redisPubClient = new Redis(baseOptions);
export const redisSubClient = new Redis(baseOptions);
