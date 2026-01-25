import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn({ err, statusCode: err.statusCode }, 'Application error');
      return c.json(
        {
          error: err.message,
          code: err.code,
        },
        err.statusCode as 400 | 401 | 403 | 404 | 429 | 500
      );
    }

    if (err instanceof ZodError) {
      logger.warn({ err }, 'Validation error');
      return c.json(
        {
          error: 'Validation failed',
          details: err.flatten().fieldErrors,
        },
        400
      );
    }

    if (err instanceof HTTPException) {
      logger.warn({ err, statusCode: err.status }, 'HTTP exception');
      return c.json(
        {
          error: err.message,
        },
        err.status
      );
    }

    logger.error({ err }, 'Unhandled error');
    return c.json(
      {
        error: 'Internal server error',
      },
      500
    );
  }
}
