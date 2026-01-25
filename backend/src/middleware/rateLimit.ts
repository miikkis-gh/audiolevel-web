import type { Context, Next } from 'hono';
import { checkRateLimit, getClientIp, type RateLimitConfig } from '../services/rateLimit';
import { logger } from '../utils/logger';

export interface RateLimitOptions extends Partial<RateLimitConfig> {
  message?: string;
  statusCode?: number;
  headers?: boolean;
  skip?: (c: Context) => boolean | Promise<boolean>;
  keyGenerator?: (c: Context) => string;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests, please try again later',
  statusCode: 429,
  headers: true,
  keyPrefix: 'ratelimit:upload:',
};

/**
 * Rate limiting middleware for Hono
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (c: Context, next: Next) => {
    // Check if we should skip rate limiting
    if (config.skip) {
      const shouldSkip = await config.skip(c);
      if (shouldSkip) {
        return next();
      }
    }

    // Generate the rate limit key
    const identifier = config.keyGenerator
      ? config.keyGenerator(c)
      : getClientIp(c.req.raw.headers);

    // Check rate limit
    const result = await checkRateLimit(identifier, {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyPrefix: config.keyPrefix,
    });

    // Set rate limit headers
    if (config.headers) {
      c.header('X-RateLimit-Limit', String(config.maxRequests));
      c.header('X-RateLimit-Remaining', String(result.remaining));
      c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

      if (!result.allowed && result.retryAfter) {
        c.header('Retry-After', String(result.retryAfter));
      }
    }

    if (!result.allowed) {
      logger.warn(
        {
          ip: identifier,
          retryAfter: result.retryAfter,
        },
        'Request blocked by rate limiter'
      );

      return c.json(
        {
          error: config.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: result.retryAfter,
        },
        config.statusCode as 429
      );
    }

    return next();
  };
}

/**
 * Strict rate limiter for upload endpoint (10 per hour)
 */
export const uploadRateLimiter = rateLimitMiddleware({
  maxRequests: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'ratelimit:upload:',
  message: 'Upload limit exceeded. You can upload 10 files per hour.',
});

/**
 * General API rate limiter (100 per minute)
 */
export const apiRateLimiter = rateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'ratelimit:api:',
  message: 'Too many requests. Please slow down.',
});
