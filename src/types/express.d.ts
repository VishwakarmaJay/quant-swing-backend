import 'express';

import type { AuthUser } from '@services/auth';
import type { AuthTokenPayload } from '@utils/jwt';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      token?: AuthTokenPayload;
      user?: AuthUser;
    }
  }
}

export {};
