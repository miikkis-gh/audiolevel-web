/**
 * Application-wide constants
 *
 * Centralizes magic numbers and configuration values for easy adjustment.
 * All values are typed as const for better TypeScript inference.
 *
 * @module config/constants
 */

/**
 * Rate limiting configuration for different endpoint types.
 * Values define requests allowed per time window.
 */
export const RATE_LIMITS = {
  UPLOAD: {
    maxRequests: 10,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },
  API: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  STATUS: {
    maxRequests: 30,
    windowMs: 60 * 1000, // 1 minute
  },
} as const;

// WebSocket
export const WEBSOCKET = {
  HEARTBEAT_INTERVAL_MS: 30000,
  HEARTBEAT_TIMEOUT_MS: 60000,
  MAX_SUBSCRIPTIONS_PER_CONNECTION: 100,
} as const;

// File handling
export const FILE_HANDLING = {
  HEADER_SIZE_BYTES: 8192, // For MIME type detection
  MAX_FILENAME_LENGTH: 200,
} as const;

// Disk monitoring
export const DISK_THRESHOLDS = {
  WARNING_PERCENT: 80,
  CRITICAL_PERCENT: 90,
  MIN_FREE_BYTES: 500 * 1024 * 1024, // 500MB
  CHECK_CACHE_MS: 30000, // 30 seconds
} as const;

// Cleanup
export const CLEANUP = {
  AGE_BASED_INTERVAL_CRON: '*/5 * * * *', // Every 5 minutes
  ORPHAN_INTERVAL_CRON: '*/10 * * * *', // Every 10 minutes
  ORPHAN_MIN_AGE_MS: 5 * 60 * 1000, // 5 minutes
} as const;

// Queue thresholds
export const QUEUE_THRESHOLDS = {
  HIGH_LOAD_WAITING: 50,
  ESTIMATED_SECONDS_PER_JOB: 30,
} as const;

// Job ID format (nanoid)
export const JOB_ID = {
  LENGTH: 12,
  REGEX: /^[a-zA-Z0-9_-]{12}$/,
} as const;
