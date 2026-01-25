import { getRedisClient } from './redis';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'ratelimit:upload:',
};

/**
 * Check if a request is allowed under rate limiting
 */
export async function checkRateLimit(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): Promise<RateLimitResult> {
  const { maxRequests, windowMs, keyPrefix } = { ...DEFAULT_CONFIG, ...config };
  const log = createChildLogger({ identifier, maxRequests, windowMs });

  const redis = getRedisClient();
  const key = `${keyPrefix}${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Use Redis sorted set for sliding window rate limiting
    // Score = timestamp, Member = unique request ID
    const requestId = `${now}-${Math.random().toString(36).substring(2, 9)}`;

    // Start a pipeline for atomic operations
    const pipeline = redis.pipeline();

    // Remove expired entries (outside the window)
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    pipeline.zcard(key);

    // Add this request (will be removed if not allowed)
    pipeline.zadd(key, now, requestId);

    // Set expiration on the key
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Redis pipeline failed');
    }

    // Get the count before adding this request
    const currentCount = (results[1][1] as number) || 0;

    if (currentCount >= maxRequests) {
      // Remove the request we just added since it's not allowed
      await redis.zrem(key, requestId);

      // Get the oldest request timestamp to calculate retry-after
      const oldestRequests = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTimestamp = oldestRequests.length >= 2 ? parseInt(oldestRequests[1], 10) : now;
      const resetAt = oldestTimestamp + windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);

      log.warn(
        { currentCount, maxRequests, retryAfter },
        'Rate limit exceeded'
      );

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }

    const remaining = maxRequests - currentCount - 1;

    log.debug({ currentCount: currentCount + 1, remaining }, 'Rate limit check passed');

    return {
      allowed: true,
      remaining,
      resetAt: now + windowMs,
    };
  } catch (err) {
    log.error({ err }, 'Rate limit check failed, allowing request');
    // On Redis failure, allow the request (fail open)
    return {
      allowed: true,
      remaining: maxRequests,
      resetAt: now + windowMs,
    };
  }
}

/**
 * Get current rate limit status without consuming a request
 */
export async function getRateLimitStatus(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): Promise<{ count: number; remaining: number; resetAt: number }> {
  const { maxRequests, windowMs, keyPrefix } = { ...DEFAULT_CONFIG, ...config };

  const redis = getRedisClient();
  const key = `${keyPrefix}${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Remove expired and count
    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    return {
      count,
      remaining: Math.max(0, maxRequests - count),
      resetAt: now + windowMs,
    };
  } catch {
    return {
      count: 0,
      remaining: maxRequests,
      resetAt: now + windowMs,
    };
  }
}

/**
 * Reset rate limit for an identifier (admin use)
 */
export async function resetRateLimit(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): Promise<void> {
  const { keyPrefix } = { ...DEFAULT_CONFIG, ...config };
  const redis = getRedisClient();
  const key = `${keyPrefix}${identifier}`;

  await redis.del(key);
  logger.info({ identifier }, 'Rate limit reset');
}

/**
 * Extract client IP from request headers
 */
export function getClientIp(headers: Headers): string {
  // Check common proxy headers
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback (should be set by the server)
  return headers.get('cf-connecting-ip') || 'unknown';
}
