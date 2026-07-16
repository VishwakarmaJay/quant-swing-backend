import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { login } from '@services/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const result = await login(email, password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
