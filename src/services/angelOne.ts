import { generateSync } from 'otplib';

import { env } from '@config/env';
import logger from '@services/logger';
import { redis } from '@services/redis';
import { ServiceUnavailableError } from '@utils/errors';

const LOGIN_URL = 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword';
const SESSION_CACHE_KEY = 'angelone:session';
const SESSION_TTL_SECONDS = 20 * 60 * 60; // Angel One tokens last ~24h; refresh well before

export type AngelOneSession = {
  jwtToken: string;
  feedToken: string;
};

let cached: AngelOneSession | null = null;

export const hasAngelOneCredentials = (): boolean =>
  Boolean(
    env.ANGELONE_API_KEY &&
      env.ANGELONE_CLIENT_CODE &&
      env.ANGELONE_MPIN &&
      env.ANGELONE_TOTP_SECRET,
  );

const loginByPassword = async (): Promise<AngelOneSession> => {
  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': env.ANGELONE_API_KEY!,
    },
    body: JSON.stringify({
      clientcode: env.ANGELONE_CLIENT_CODE,
      password: env.ANGELONE_MPIN,
      totp: generateSync({ secret: env.ANGELONE_TOTP_SECRET! }),
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: { jwtToken?: string; feedToken?: string };
  } | null;

  if (!response.ok || !body?.status || !body.data?.jwtToken || !body.data.feedToken) {
    throw new ServiceUnavailableError(
      `Angel One login failed: ${body?.message ?? `status ${response.status}`}`,
    );
  }

  return { jwtToken: body.data.jwtToken, feedToken: body.data.feedToken };
};

/** Returns a cached Angel One session (memory → Redis → fresh login). */
export const getAngelOneSession = async (): Promise<AngelOneSession> => {
  if (cached) return cached;

  if (redis.status === 'ready') {
    const stored = await redis.get(SESSION_CACHE_KEY);
    if (stored) {
      cached = JSON.parse(stored) as AngelOneSession;
      return cached;
    }
  }

  cached = await loginByPassword();
  if (redis.status === 'ready') {
    await redis.setex(SESSION_CACHE_KEY, SESSION_TTL_SECONDS, JSON.stringify(cached));
  }
  logger.info('[AngelOne]: login ok');
  return cached;
};

/** Drops the cached session (call when the broker rejects the token). */
export const invalidateAngelOneSession = async (): Promise<void> => {
  cached = null;
  if (redis.status === 'ready') await redis.del(SESSION_CACHE_KEY);
};
