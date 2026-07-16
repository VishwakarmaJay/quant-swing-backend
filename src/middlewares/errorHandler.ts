import type { NextFunction, Request, Response } from 'express';

import { AppError, parseZodError } from '@utils/errors';
import { JsonWebTokenError } from 'jsonwebtoken';
import { ZodError } from 'zod';
import type { ParsedResponse } from '../types/error';

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const response: ParsedResponse = {
    message: 'Something went wrong',
    error,
    statusCode: 501,
  };

  if (error instanceof Error) {
    response.message = error.message;
    response.stack = error.stack;
  }

  if (error instanceof AppError) {
    response.message = error.message;
    response.statusCode = error.statusCode;

    if (error.error) error = error.error;
  }

  if (error instanceof ZodError) {
    const { message, stack } = parseZodError(error);
    response.message = message;
    response.stack = stack;

    if (response.statusCode >= 500) response.statusCode = 400;
  }

  if (error instanceof JsonWebTokenError) {
    response.message = 'Invalid or Expired Token';
    response.stack = error.stack;
    response.statusCode = 401;
  }

  console.error(`Error in API: ${req.originalUrl}: `, response);

  if (process.env.NODE_ENV !== 'development') delete response.stack;

  res.status(response.statusCode).send(response);
};
