import jwt from 'jsonwebtoken';

import { env } from '@config/env';

export interface AuthTokenPayload {
  sub: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export const signToken = (payload: { sub: string; jti: string }): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });

export const verifyToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as AuthTokenPayload;
