import { getUserProfile } from '@services/auth';
import { UnauthorizedError } from '@utils/errors';
import { verifyToken } from '@utils/jwt';
import type { NextFunction, Request, Response } from 'express';
import z from 'zod';

export const verifyUser = async (req: Request, _res: Response, next: NextFunction) => {
  const auth = z.string().optional().parse(req.headers['authorization']);

  if (!auth) throw new UnauthorizedError('No authorization token provided');

  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth;

  const payload = verifyToken(token);
  if (!payload.sub || !payload.jti) throw new UnauthorizedError('Invalid token');

  req.user = await getUserProfile(payload.sub);
  next();
};
