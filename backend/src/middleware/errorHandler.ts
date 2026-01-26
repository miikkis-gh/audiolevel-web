import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

// Error codes with user-friendly messages and recovery hints
export const ERROR_MESSAGES: Record<string, { message: string; hint?: string }> = {
  // File errors
  NO_FILE: {
    message: 'No file was uploaded',
    hint: 'Please select an audio file to upload.',
  },
  FILE_TOO_LARGE: {
    message: 'File exceeds the maximum size limit',
    hint: 'Please upload a file smaller than 100MB.',
  },
  INVALID_FILE_TYPE: {
    message: 'Unsupported file format',
    hint: 'Supported formats: WAV, MP3, FLAC, AAC, OGG.',
  },
  INVALID_FORMAT: {
    message: 'The file appears to be corrupted or invalid',
    hint: 'Please try uploading a different file.',
  },
  FILE_EXPIRED: {
    message: 'This file has expired and is no longer available',
    hint: 'Files are automatically deleted after 15 minutes. Please upload again.',
  },

  // Job errors
  JOB_NOT_FOUND: {
    message: 'Processing job not found',
    hint: 'The job may have expired. Please upload your file again.',
  },
  NOT_READY: {
    message: 'File is still being processed',
    hint: 'Please wait for processing to complete.',
  },
  PROCESSING_FAILED: {
    message: 'Audio processing failed',
    hint: 'There was an issue with your file. Please try a different file or format.',
  },
  PROCESSING_TIMEOUT: {
    message: 'Processing took too long and was cancelled',
    hint: 'Large files may take longer. Try a shorter audio file.',
  },

  // Rate limiting
  RATE_LIMITED: {
    message: 'Upload limit reached',
    hint: 'You can upload up to 10 files per hour. Please try again later.',
  },

  // Server errors
  QUEUE_OVERLOADED: {
    message: 'Server is currently busy',
    hint: 'Please try again in a few minutes.',
  },
  INSUFFICIENT_STORAGE: {
    message: 'Server storage is temporarily full',
    hint: 'Please try again in a few minutes.',
  },
  SERVICE_UNAVAILABLE: {
    message: 'Service is temporarily unavailable',
    hint: 'We are working to restore service. Please try again later.',
  },
};

export class AppError extends Error {
  public hint?: string;

  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';

    // Add hint from error messages if available
    if (code && ERROR_MESSAGES[code]) {
      this.hint = ERROR_MESSAGES[code].hint;
    }
  }
}

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn({ err, statusCode: err.statusCode, code: err.code }, 'Application error');
      return c.json(
        {
          error: err.message,
          code: err.code,
          hint: err.hint,
        },
        err.statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 503
      );
    }

    if (err instanceof ZodError) {
      logger.warn({ err }, 'Validation error');
      return c.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          hint: 'Please check your input and try again.',
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
          code: 'HTTP_ERROR',
        },
        err.status
      );
    }

    logger.error({ err }, 'Unhandled error');
    return c.json(
      {
        error: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
        hint: 'Please try again. If the problem persists, contact support.',
      },
      500
    );
  }
}
