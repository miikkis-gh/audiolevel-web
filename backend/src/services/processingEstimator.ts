import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AnalysisMetrics } from '../types/analysis';
import type { AudioFingerprint, ProcessingOutcome } from '../types/estimator';

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
 * Load processing history from JSON file
 */
export function loadHistory(historyPath: string): ProcessingOutcome[] {
  if (!existsSync(historyPath)) {
    return [];
  }

  try {
    const content = readFileSync(historyPath, 'utf-8');
    return JSON.parse(content) as ProcessingOutcome[];
  } catch {
    return [];
  }
}

/**
 * Save a processing outcome to history
 */
export function saveOutcome(outcome: ProcessingOutcome, historyPath: string, maxHistory = 10000): void {
  // Ensure directory exists
  const dir = dirname(historyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const history = loadHistory(historyPath);
  history.push(outcome);

  // Prune oldest entries if over limit
  const pruned = history.length > maxHistory
    ? history.slice(history.length - maxHistory)
    : history;

  writeFileSync(historyPath, JSON.stringify(pruned, null, 2));
}

/**
 * Clear all history (for testing)
 */
export function clearHistory(historyPath: string): void {
  const dir = dirname(historyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(historyPath, '[]');
}
