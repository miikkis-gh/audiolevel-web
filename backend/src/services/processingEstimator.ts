import type { AnalysisMetrics } from '../types/analysis';
import type { AudioFingerprint, ProcessingOutcome, SimilarMatch, EstimatorConfig, EstimatorStats } from '../types/estimator';
import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { getRedisClient } from './redis';

const log = createChildLogger({ service: 'processingEstimator' });

const REDIS_HISTORY_KEY = 'estimator:history';
const REDIS_STATS_KEY = 'estimator:stats';

/**
 * Get estimator config from environment
 */
export function getEstimatorConfig(): EstimatorConfig {
  return {
    highThreshold: env.ESTIMATOR_HIGH_THRESHOLD,
    moderateThreshold: env.ESTIMATOR_MODERATE_THRESHOLD,
    maxHistory: env.ESTIMATOR_MAX_HISTORY,
    enabled: env.ESTIMATOR_ENABLED,
  };
}

/**
 * Log a prediction result
 */
export function logPrediction(
  predicted: string,
  actual: string,
  confidence: 'high' | 'moderate',
  distance: number
): void {
  const correct = predicted === actual;
  if (correct) {
    log.info({ predicted, distance, confidence }, 'Prediction HIT');
  } else {
    log.info({ predicted, actual, distance, confidence }, 'Prediction MISS');
  }
}

/**
 * Normalization ranges for each metric
 */
const METRIC_RANGES = {
  integratedLufs: { min: -60, max: 0 },
  loudnessRange: { min: 0, max: 30 },
  silenceRatio: { min: 0, max: 1 },
  spectralCentroid: { min: 100, max: 8000 },
  spectralFlatness: { min: 0, max: 1 },
} as const;

type MetricKey = keyof typeof METRIC_RANGES;

/**
 * Normalize a metric value to 0-1 range
 */
function normalizeMetric(value: number, metric: MetricKey): number {
  const range = METRIC_RANGES[metric];
  const clamped = Math.max(range.min, Math.min(range.max, value));
  return (clamped - range.min) / (range.max - range.min);
}

/**
 * Compute Euclidean distance between two fingerprints (0-1 scale)
 */
export function computeDistance(a: AudioFingerprint, b: AudioFingerprint): number {
  const metrics: MetricKey[] = [
    'integratedLufs',
    'loudnessRange',
    'silenceRatio',
    'spectralCentroid',
    'spectralFlatness',
  ];

  let sumSquares = 0;
  for (const metric of metrics) {
    const normA = normalizeMetric(a[metric], metric);
    const normB = normalizeMetric(b[metric], metric);
    sumSquares += (normA - normB) ** 2;
  }

  // Normalize by number of dimensions to keep result in 0-1 range
  return Math.sqrt(sumSquares / metrics.length);
}

/**
 * Extract the 5 core metrics used for similarity matching
 */
export function extractFingerprint(metrics: AnalysisMetrics): AudioFingerprint {
  return {
    integratedLufs: metrics.integratedLufs,
    loudnessRange: metrics.loudnessRange,
    silenceRatio: metrics.silenceRatio,
    spectralCentroid: metrics.spectralCentroid,
    spectralFlatness: metrics.spectralFlatness,
  };
}

/**
 * Load processing history from Redis
 */
export async function loadHistory(): Promise<ProcessingOutcome[]> {
  try {
    const redis = getRedisClient();
    const entries = await redis.lrange(REDIS_HISTORY_KEY, 0, -1);
    return entries.map((entry) => JSON.parse(entry) as ProcessingOutcome);
  } catch (err) {
    log.error({ err }, 'Failed to load history from Redis');
    return [];
  }
}

/**
 * Save a processing outcome to history
 */
export async function saveOutcome(outcome: ProcessingOutcome, maxHistory = 10000): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.rpush(REDIS_HISTORY_KEY, JSON.stringify(outcome));
    // Trim to keep only the latest maxHistory entries
    await redis.ltrim(REDIS_HISTORY_KEY, -maxHistory, -1);
  } catch (err) {
    log.error({ err }, 'Failed to save outcome to Redis');
  }
}

/**
 * Clear all history
 */
export async function clearHistory(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(REDIS_HISTORY_KEY);
  } catch (err) {
    log.error({ err }, 'Failed to clear history from Redis');
  }
}

/**
 * Find similar historical processing outcomes
 */
export async function findSimilar(
  fingerprint: AudioFingerprint,
  config: EstimatorConfig
): Promise<SimilarMatch | null> {
  const history = await loadHistory();

  if (history.length === 0) {
    return null;
  }

  // Find all matches within moderate threshold
  const matches: Array<{ outcome: ProcessingOutcome; distance: number }> = [];

  for (const outcome of history) {
    const distance = computeDistance(fingerprint, outcome.fingerprint);
    if (distance <= config.moderateThreshold) {
      matches.push({ outcome, distance });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Sort by distance (closest first)
  matches.sort((a, b) => a.distance - b.distance);

  const closest = matches[0];
  const confidence = closest.distance <= config.highThreshold ? 'high' : 'moderate';

  // Count how many matches agree on the winner
  const matchCount = matches.filter(
    m => m.outcome.winnerCandidateId === closest.outcome.winnerCandidateId
  ).length;

  return {
    confidence,
    predictedWinner: closest.outcome.winnerCandidateId,
    predictedAggressiveness: closest.outcome.winnerAggressiveness,
    distance: closest.distance,
    matchCount,
  };
}

const DEFAULT_STATS: EstimatorStats = {
  totalPredictions: 0,
  highConfidenceHits: 0,
  highConfidenceMisses: 0,
  moderateConfidenceHits: 0,
  moderateConfidenceMisses: 0,
  lastUpdated: 0,
};

/**
 * Load estimator stats from Redis
 */
export async function loadStats(): Promise<EstimatorStats> {
  try {
    const redis = getRedisClient();
    const data = await redis.hgetall(REDIS_STATS_KEY);
    if (!data || Object.keys(data).length === 0) {
      return { ...DEFAULT_STATS };
    }
    return {
      totalPredictions: parseInt(data.totalPredictions || '0', 10),
      highConfidenceHits: parseInt(data.highConfidenceHits || '0', 10),
      highConfidenceMisses: parseInt(data.highConfidenceMisses || '0', 10),
      moderateConfidenceHits: parseInt(data.moderateConfidenceHits || '0', 10),
      moderateConfidenceMisses: parseInt(data.moderateConfidenceMisses || '0', 10),
      lastUpdated: parseInt(data.lastUpdated || '0', 10),
    };
  } catch (err) {
    log.error({ err }, 'Failed to load stats from Redis');
    return { ...DEFAULT_STATS };
  }
}

/**
 * Record a prediction result for stats tracking
 */
export async function recordPredictionResult(
  confidence: 'high' | 'moderate',
  correct: boolean,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const field = confidence === 'high'
      ? (correct ? 'highConfidenceHits' : 'highConfidenceMisses')
      : (correct ? 'moderateConfidenceHits' : 'moderateConfidenceMisses');

    await redis
      .multi()
      .hincrby(REDIS_STATS_KEY, 'totalPredictions', 1)
      .hincrby(REDIS_STATS_KEY, field, 1)
      .hset(REDIS_STATS_KEY, 'lastUpdated', Date.now().toString())
      .exec();
  } catch (err) {
    log.error({ err }, 'Failed to record prediction result in Redis');
  }
}
