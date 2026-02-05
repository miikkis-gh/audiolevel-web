import { getRedisClient } from './redis';
import { logger } from '../utils/logger';

// Redis key prefixes
const KEYS = {
  TOTAL_FILES: 'stats:total_files',
  TOTAL_DURATION: 'stats:total_duration', // in seconds
  DAILY_FILES: 'stats:daily:', // stats:daily:YYYY-MM-DD
  WEEKLY_FILES: 'stats:weekly:', // stats:weekly:YYYY-WW
  HOURLY_FILES: 'stats:hourly:', // stats:hourly:YYYY-MM-DD-HH
  CONTENT_TYPE: 'stats:content_type:', // stats:content_type:music, stats:content_type:speech
  RECENT_ACTIVITY: 'stats:recent_activity', // list of recent activity events
};

const MAX_RECENT_ACTIVITY = 20;
const ACTIVITY_TTL_SECONDS = 86400; // 24 hours
const HOURLY_TTL_SECONDS = 43200; // 12 hours (keep enough for 6hr graph)

export interface ActivityEvent {
  contentType: string;
  timestamp: number;
}

export interface ActivityStats {
  totalFiles: number;
  totalDurationSeconds: number;
  todayFiles: number;
  weekFiles: number;
  contentBreakdown: {
    music: number;
    speech: number;
    podcast: number;
    other: number;
  };
  recentActivity: ActivityEvent[];
}

/**
 * Get current date key (YYYY-MM-DD)
 */
function getDailyKey(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Get current week key (YYYY-WW)
 */
function getWeeklyKey(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-${week.toString().padStart(2, '0')}`;
}

/**
 * Get hourly key (YYYY-MM-DD-HH)
 */
function getHourlyKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const hh = date.getHours().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

/**
 * Normalize content type to category
 */
function normalizeContentType(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes('music')) return 'music';
  if (lower.includes('speech')) return 'speech';
  if (lower.includes('podcast') || lower.includes('mixed')) return 'podcast';
  return 'other';
}

/**
 * Record a completed job in activity stats
 */
export async function recordJobCompletion(
  contentType: string,
  durationSeconds: number
): Promise<void> {
  const redis = getRedisClient();
  const normalizedType = normalizeContentType(contentType);
  const dailyKey = getDailyKey();
  const weeklyKey = getWeeklyKey();
  const hourlyKey = getHourlyKey();

  try {
    const pipeline = redis.pipeline();

    // Increment counters
    pipeline.incr(KEYS.TOTAL_FILES);
    pipeline.incrbyfloat(KEYS.TOTAL_DURATION, durationSeconds);
    pipeline.incr(`${KEYS.DAILY_FILES}${dailyKey}`);
    pipeline.incr(`${KEYS.WEEKLY_FILES}${weeklyKey}`);
    pipeline.incr(`${KEYS.HOURLY_FILES}${hourlyKey}`);
    pipeline.incr(`${KEYS.CONTENT_TYPE}${normalizedType}`);

    // Set TTL on daily/weekly/hourly keys
    pipeline.expire(`${KEYS.DAILY_FILES}${dailyKey}`, 604800); // 7 days
    pipeline.expire(`${KEYS.WEEKLY_FILES}${weeklyKey}`, 2592000); // 30 days
    pipeline.expire(`${KEYS.HOURLY_FILES}${hourlyKey}`, HOURLY_TTL_SECONDS);

    // Add to recent activity (capped list)
    const activityEvent: ActivityEvent = {
      contentType: normalizedType,
      timestamp: Date.now(),
    };
    pipeline.lpush(KEYS.RECENT_ACTIVITY, JSON.stringify(activityEvent));
    pipeline.ltrim(KEYS.RECENT_ACTIVITY, 0, MAX_RECENT_ACTIVITY - 1);
    pipeline.expire(KEYS.RECENT_ACTIVITY, ACTIVITY_TTL_SECONDS);

    await pipeline.exec();

    logger.debug({ contentType: normalizedType, durationSeconds }, 'Recorded job completion in stats');
  } catch (err) {
    logger.error({ err }, 'Failed to record activity stats');
  }
}

/**
 * Get current activity statistics
 */
export async function getActivityStats(): Promise<ActivityStats> {
  const redis = getRedisClient();
  const dailyKey = getDailyKey();
  const weeklyKey = getWeeklyKey();

  try {
    const [
      totalFiles,
      totalDuration,
      todayFiles,
      weekFiles,
      musicCount,
      speechCount,
      podcastCount,
      otherCount,
      recentActivityRaw,
    ] = await Promise.all([
      redis.get(KEYS.TOTAL_FILES),
      redis.get(KEYS.TOTAL_DURATION),
      redis.get(`${KEYS.DAILY_FILES}${dailyKey}`),
      redis.get(`${KEYS.WEEKLY_FILES}${weeklyKey}`),
      redis.get(`${KEYS.CONTENT_TYPE}music`),
      redis.get(`${KEYS.CONTENT_TYPE}speech`),
      redis.get(`${KEYS.CONTENT_TYPE}podcast`),
      redis.get(`${KEYS.CONTENT_TYPE}other`),
      redis.lrange(KEYS.RECENT_ACTIVITY, 0, MAX_RECENT_ACTIVITY - 1),
    ]);

    const recentActivity: ActivityEvent[] = recentActivityRaw
      .map((item) => {
        try {
          return JSON.parse(item) as ActivityEvent;
        } catch {
          return null;
        }
      })
      .filter((item): item is ActivityEvent => item !== null);

    return {
      totalFiles: parseInt(totalFiles || '0', 10),
      totalDurationSeconds: parseFloat(totalDuration || '0'),
      todayFiles: parseInt(todayFiles || '0', 10),
      weekFiles: parseInt(weekFiles || '0', 10),
      contentBreakdown: {
        music: parseInt(musicCount || '0', 10),
        speech: parseInt(speechCount || '0', 10),
        podcast: parseInt(podcastCount || '0', 10),
        other: parseInt(otherCount || '0', 10),
      },
      recentActivity,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get activity stats');
    return {
      totalFiles: 0,
      totalDurationSeconds: 0,
      todayFiles: 0,
      weekFiles: 0,
      contentBreakdown: { music: 0, speech: 0, podcast: 0, other: 0 },
      recentActivity: [],
    };
  }
}

export interface HourlyDataPoint {
  hour: string; // HH:00 format
  count: number;
}

/**
 * Get hourly activity for the last N hours
 */
export async function getHourlyActivity(hours: number = 6): Promise<HourlyDataPoint[]> {
  const redis = getRedisClient();
  const now = new Date();
  const dataPoints: HourlyDataPoint[] = [];

  try {
    // Generate keys for the last N hours
    const keys: string[] = [];
    const labels: string[] = [];

    for (let i = hours - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 60 * 60 * 1000);
      keys.push(`${KEYS.HOURLY_FILES}${getHourlyKey(date)}`);
      labels.push(`${date.getHours().toString().padStart(2, '0')}:00`);
    }

    // Fetch all counts in parallel
    const counts = await Promise.all(keys.map((key) => redis.get(key)));

    for (let i = 0; i < labels.length; i++) {
      dataPoints.push({
        hour: labels[i],
        count: parseInt(counts[i] || '0', 10),
      });
    }

    return dataPoints;
  } catch (err) {
    logger.error({ err }, 'Failed to get hourly activity');
    return [];
  }
}
