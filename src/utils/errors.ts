import type { ZodError } from 'zod';
import type { ParsedError } from '../types/error';

export class AppError extends Error {
  constructor(
    override readonly message: string,
    public readonly statusCode: number,
    public readonly error?: unknown,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * Takes a ZodError and returns a ParsedError object with a prettyMessage
 * that is a concatenation of the first issue's path and message.
 *
 * @example
 * const error = new ZodError([
 *   {
 *     code: 'invalid_type',
 *     expected: 'string',
 *     received: 'number',
 *     path: ['user', 'name'],
 *     message: 'Expected string, received number',
 *   },
 * ]);
 * const parsedError = parseZodError(error);
 * // parsedError will be { message: 'User Name Expected string, received number', stack: undefined }
 *
 * @param error - The zod error to parse
 * @returns A ParsedError object with a prettyMessage and optional stack
 */
export function parseZodError(error: ZodError<unknown>): ParsedError {
  // Concat the first zod error into a pretty message

  const firstIssue = error.issues[0];

  const fieldName = firstIssue?.path[1] ?? firstIssue?.path[0];

  const prettyMessage = `${String(fieldName)} ${firstIssue?.message}`;

  return { message: prettyMessage, stack: error.stack };
}
