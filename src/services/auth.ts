import { randomUUID } from 'node:crypto';

import type { User } from '@generated/prisma/client';
import { UnauthorizedError } from '@utils/errors';
import { signToken } from '@utils/jwt';
import { prisma } from '@services/prisma';
import { redis } from '@services/redis';

export type AuthUser = Omit<User, 'passwordHash'>;

const USER_CACHE_TTL_SECONDS = 5 * 60;

const toAuthUser = (user: User): AuthUser => {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
};

const userKey = (userId: string) => `user:${userId}`;

export const login = async (
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) throw new UnauthorizedError('Invalid credentials');

  const ok = await Bun.password.verify(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  const jti = randomUUID();
  const token = signToken({ sub: user.id, jti });

  return { token, user: toAuthUser(user) };
};

export const getUserProfile = async (userId: string): Promise<AuthUser> => {
  const cachedUser = await redis.get(userKey(userId));
  if (cachedUser) return JSON.parse(cachedUser) as AuthUser;

  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
  if (!user) throw new UnauthorizedError('User not found or inactive');

  const safe = toAuthUser(user);
  await redis.setex(userKey(userId), USER_CACHE_TTL_SECONDS, JSON.stringify(safe));
  return safe;
};

export const invalidateUserCache = async (userId: string): Promise<void> => {
  if (redis.status !== 'ready') return;
  await redis.del(userKey(userId));
};
