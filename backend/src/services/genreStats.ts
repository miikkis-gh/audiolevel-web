/**
 * Genre Statistics Service
 *
 * Manages Redis storage for genre statistics including
 * aggregate counters and daily breakdowns.
 *
 * @module services/genreStats
 */

import { getRedisClient } from './redis';
import { logger } from '../utils/logger';
import type { BroadGenre } from './genreHeuristics';
import { BROAD_GENRES, getBroadGenreForSubcategory } from './genreHeuristics';

// Redis key prefixes
const KEYS = {
  GENRE_BROAD: 'stats:genre:broad:', // stats:genre:broad:electronic
  GENRE_DETAILED: 'stats:genre:detailed:', // stats:genre:detailed:house
  GENRE_DAILY: 'stats:genre:daily:', // stats:genre:daily:2026-02-05:electronic
  GENRE_JOB: 'genre:job:', // genre:job:{jobId}
};

const DAILY_TTL_SECONDS = 604800; // 7 days
const JOB_TTL_SECONDS = 900; // 15 minutes (same as file retention)

export interface GenreConfirmation {
  broad: string;
  detailed?: string;
}

export interface GenreJobData {
  guess: string;
  confidence: string;
  confirmed?: string;
  confirmedDetailed?: string;
}

export interface GenreStatsResult {
  topGenres: { genre: string; count: number; percentage: number }[];
  todayBreakdown: { genre: string; count: number; percentage: number }[];
  totalConfirmed: number;
  todayConfirmed: number;
}

/**
 * Get current date key (YYYY-MM-DD)
 */
function getDailyKey(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Normalize genre name to lowercase key
 */
function normalizeGenreKey(genre: string): string {
  return genre.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/**
 * Store initial genre guess for a job
 */
export async function storeGenreGuess(
  jobId: string,
  guess: string,
  confidence: string
): Promise<void> {
  const redis = getRedisClient();

  try {
    const data: GenreJobData = { guess, confidence };
    await redis.set(`${KEYS.GENRE_JOB}${jobId}`, JSON.stringify(data), 'EX', JOB_TTL_SECONDS);
    logger.debug({ jobId, guess, confidence }, 'Stored genre guess');
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to store genre guess');
  }
}

/**
 * Get genre guess for a job
 */
export async function getGenreGuess(jobId: string): Promise<GenreJobData | null> {
  const redis = getRedisClient();

  try {
    const data = await redis.get(`${KEYS.GENRE_JOB}${jobId}`);
    if (data) {
      return JSON.parse(data) as GenreJobData;
    }
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to get genre guess');
  }
  return null;
}

/**
 * Record a user's genre confirmation
 */
export async function recordGenreConfirmation(
  jobId: string,
  broad: string,
  detailed?: string
): Promise<void> {
  const redis = getRedisClient();
  const dailyKey = getDailyKey();

  // If detailed is provided, ensure we have the correct broad category
  let finalBroad = broad;
  if (detailed) {
    const parentBroad = getBroadGenreForSubcategory(detailed);
    if (parentBroad) {
      finalBroad = parentBroad;
    }
  }

  const broadKey = normalizeGenreKey(finalBroad);
  const detailedKey = detailed ? normalizeGenreKey(detailed) : null;

  try {
    const pipeline = redis.pipeline();

    // Increment broad genre counter
    pipeline.incr(`${KEYS.GENRE_BROAD}${broadKey}`);

    // Increment daily broad genre counter
    pipeline.incr(`${KEYS.GENRE_DAILY}${dailyKey}:${broadKey}`);
    pipeline.expire(`${KEYS.GENRE_DAILY}${dailyKey}:${broadKey}`, DAILY_TTL_SECONDS);

    // Increment detailed genre counter if provided
    if (detailedKey) {
      pipeline.incr(`${KEYS.GENRE_DETAILED}${detailedKey}`);
    }

    // Update job data with confirmation
    const existingData = await getGenreGuess(jobId);
    if (existingData) {
      existingData.confirmed = finalBroad;
      if (detailed) {
        existingData.confirmedDetailed = detailed;
      }
      pipeline.set(`${KEYS.GENRE_JOB}${jobId}`, JSON.stringify(existingData), 'EX', JOB_TTL_SECONDS);
    }

    await pipeline.exec();
    logger.info({ jobId, broad: finalBroad, detailed }, 'Recorded genre confirmation');
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to record genre confirmation');
  }
}

/**
 * Get aggregated genre statistics
 */
export async function getGenreStats(): Promise<GenreStatsResult> {
  const redis = getRedisClient();
  const dailyKey = getDailyKey();

  try {
    // Get all broad genre counts
    const broadKeys = BROAD_GENRES.map((g) => `${KEYS.GENRE_BROAD}${normalizeGenreKey(g)}`);
    const dailyKeys = BROAD_GENRES.map(
      (g) => `${KEYS.GENRE_DAILY}${dailyKey}:${normalizeGenreKey(g)}`
    );

    const [broadCounts, dailyCounts] = await Promise.all([
      Promise.all(broadKeys.map((key) => redis.get(key))),
      Promise.all(dailyKeys.map((key) => redis.get(key))),
    ]);

    // Calculate totals
    const broadGenreCounts = BROAD_GENRES.map((genre, i) => ({
      genre,
      count: parseInt(broadCounts[i] || '0', 10),
    }));

    const dailyGenreCounts = BROAD_GENRES.map((genre, i) => ({
      genre,
      count: parseInt(dailyCounts[i] || '0', 10),
    }));

    const totalConfirmed = broadGenreCounts.reduce((sum, g) => sum + g.count, 0);
    const todayConfirmed = dailyGenreCounts.reduce((sum, g) => sum + g.count, 0);

    // Sort by count and calculate percentages
    const topGenres = broadGenreCounts
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((g) => ({
        ...g,
        percentage: totalConfirmed > 0 ? Math.round((g.count / totalConfirmed) * 100) : 0,
      }));

    const todayBreakdown = dailyGenreCounts
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((g) => ({
        ...g,
        percentage: todayConfirmed > 0 ? Math.round((g.count / todayConfirmed) * 100) : 0,
      }));

    return {
      topGenres,
      todayBreakdown,
      totalConfirmed,
      todayConfirmed,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get genre stats');
    return {
      topGenres: [],
      todayBreakdown: [],
      totalConfirmed: 0,
      todayConfirmed: 0,
    };
  }
}
