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
  windowMs: 15 * 60 * 1000, // 15 minutes
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
  const requestId = `${now}-${Math.random().toString(36).substring(2, 9)}`;

  // Lua script for atomic rate limiting (single round trip)
  // Returns: [allowed (0/1), count, oldestTimestamp]
  const luaScript = `
    local key = KEYS[1]
    local windowStart = tonumber(ARGV[1])
    local now = tonumber(ARGV[2])
    local maxRequests = tonumber(ARGV[3])
    local windowMs = tonumber(ARGV[4])
    local requestId = ARGV[5]

    -- Remove expired entries
    redis.call('zremrangebyscore', key, 0, windowStart)

    -- Get current count
    local count = redis.call('zcard', key)

    -- Check if allowed
    if count >= maxRequests then
      -- Get oldest timestamp for retry-after calculation
      local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
      local oldestTs = oldest[2] or now
      return {0, count, oldestTs}
    end

    -- Add this request and set expiration
    redis.call('zadd', key, now, requestId)
    redis.call('pexpire', key, windowMs)

    return {1, count, 0}
  `;

  try {
    const result = await redis.eval(
      luaScript,
      1,
      key,
      windowStart,
      now,
      maxRequests,
      windowMs,
      requestId
    ) as [number, number, number];

    const [allowed, count, oldestTimestamp] = result;

    if (!allowed) {
      const resetAt = (oldestTimestamp || now) + windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);

      log.warn(
        { currentCount: count, maxRequests, retryAfter },
        'Rate limit exceeded'
      );

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter,
      };
    }

    const remaining = maxRequests - count - 1;
    log.debug({ currentCount: count + 1, remaining }, 'Rate limit check passed');

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
    // Use pipeline for single round trip
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    const results = await pipeline.exec();

    const count = (results?.[1]?.[1] as number) || 0;

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
