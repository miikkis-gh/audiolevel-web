# Processing Estimator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add estimation system that predicts processing winners based on historical outcomes, reducing redundant candidate evaluation.

**Architecture:** New `processingEstimator.ts` service handles fingerprinting, similarity matching, and history storage. Integrates into `intelligentProcessor.ts` after analysis, before candidate generation. Uses JSON file for persistence.

**Tech Stack:** TypeScript, Bun runtime, Bun test framework, JSON file storage

---

## Task 1: Types Definition

**Files:**
- Create: `backend/src/types/estimator.ts`
- Modify: `backend/src/types/index.ts`

**Step 1: Write the types file**

```typescript
// backend/src/types/estimator.ts
import type { ContentType } from './analysis';

/**
 * Audio fingerprint based on 5 core metrics that characterize content
 */
export interface AudioFingerprint {
  integratedLufs: number;
  loudnessRange: number;
  silenceRatio: number;
  spectralCentroid: number;
  spectralFlatness: number;
}

/**
 * Historical record of a processed file and its winning candidate
 */
export interface ProcessingOutcome {
  fingerprint: AudioFingerprint;
  winnerCandidateId: string;
  winnerAggressiveness: 'conservative' | 'balanced' | 'aggressive';
  contentType: ContentType;
  timestamp: number;
  wasPredicted?: boolean;
  predictionCorrect?: boolean;
}

/**
 * Result of similarity search against history
 */
export interface SimilarMatch {
  confidence: 'high' | 'moderate';
  predictedWinner: string;
  predictedAggressiveness: 'conservative' | 'balanced' | 'aggressive';
  distance: number;
  matchCount: number;
}

/**
 * Estimator statistics for accuracy tracking
 */
export interface EstimatorStats {
  totalPredictions: number;
  highConfidenceHits: number;
  highConfidenceMisses: number;
  moderateConfidenceHits: number;
  moderateConfidenceMisses: number;
  lastUpdated: number;
}

/**
 * Configuration for the estimator
 */
export interface EstimatorConfig {
  historyPath: string;
  statsPath: string;
  highThreshold: number;
  moderateThreshold: number;
  maxHistory: number;
  enabled: boolean;
}
```

**Step 2: Export from index**

Add to `backend/src/types/index.ts`:

```typescript
export * from './estimator';
```

**Step 3: Run type check**

Run: `cd backend && bun run typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add backend/src/types/estimator.ts backend/src/types/index.ts
git commit -m "feat(estimator): add type definitions for processing estimator"
```

---

## Task 2: Environment Configuration

**Files:**
- Modify: `backend/src/config/env.ts`

**Step 1: Add estimator config to schema**

Add after the ViSQOL configuration section in `backend/src/config/env.ts`:

```typescript
  // Processing estimator configuration
  ESTIMATOR_ENABLED: z.coerce.boolean().default(true),
  ESTIMATOR_HISTORY_PATH: z.string().default('data/processing-history.json'),
  ESTIMATOR_STATS_PATH: z.string().default('data/estimator-stats.json'),
  ESTIMATOR_HIGH_THRESHOLD: z.coerce.number().default(0.05),
  ESTIMATOR_MODERATE_THRESHOLD: z.coerce.number().default(0.15),
  ESTIMATOR_MAX_HISTORY: z.coerce.number().default(10000),
```

**Step 2: Run type check**

Run: `cd backend && bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/config/env.ts
git commit -m "feat(estimator): add environment configuration for estimator"
```

---

## Task 3: Fingerprint Extraction Tests

**Files:**
- Create: `backend/src/__tests__/processingEstimator.test.ts`

**Step 1: Write failing test for fingerprint extraction**

```typescript
// backend/src/__tests__/processingEstimator.test.ts
import { describe, expect, test } from 'bun:test';
import { extractFingerprint } from '../services/processingEstimator';
import type { AnalysisMetrics } from '../types/analysis';

describe('Processing Estimator', () => {
  describe('extractFingerprint', () => {
    test('extracts correct metrics from analysis', () => {
      const metrics: AnalysisMetrics = {
        channels: 2,
        sampleRate: 48000,
        bitDepth: 24,
        duration: 120,
        integratedLufs: -18.5,
        loudnessRange: 12.3,
        truePeak: -1.2,
        rmsDb: -20,
        peakDb: -3,
        crestFactor: 17,
        silenceRatio: 0.08,
        leadingSilence: 0.5,
        trailingSilence: 0.3,
        spectralCentroid: 2500,
        spectralFlatness: 0.35,
        lowFreqEnergy: 0.2,
        midFreqEnergy: 0.5,
        highFreqEnergy: 0.2,
        veryHighFreqEnergy: 0.1,
        flatFactor: 0.01,
        peakCount: 5,
        dcOffset: 0.001,
        stereoBalance: 0.5,
      };

      const fingerprint = extractFingerprint(metrics);

      expect(fingerprint.integratedLufs).toBe(-18.5);
      expect(fingerprint.loudnessRange).toBe(12.3);
      expect(fingerprint.silenceRatio).toBe(0.08);
      expect(fingerprint.spectralCentroid).toBe(2500);
      expect(fingerprint.spectralFlatness).toBe(0.35);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && bun test processingEstimator`
Expected: FAIL with "Cannot find module '../services/processingEstimator'"

**Step 3: Commit failing test**

```bash
git add backend/src/__tests__/processingEstimator.test.ts
git commit -m "test(estimator): add failing test for fingerprint extraction"
```

---

## Task 4: Fingerprint Extraction Implementation

**Files:**
- Create: `backend/src/services/processingEstimator.ts`

**Step 1: Write minimal implementation**

```typescript
// backend/src/services/processingEstimator.ts
import type { AnalysisMetrics } from '../types/analysis';
import type { AudioFingerprint } from '../types/estimator';

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
```

**Step 2: Run test to verify it passes**

Run: `cd backend && bun test processingEstimator`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): implement fingerprint extraction"
```

---

## Task 5: Distance Calculation Tests

**Files:**
- Modify: `backend/src/__tests__/processingEstimator.test.ts`

**Step 1: Add distance calculation tests**

Add to the test file:

```typescript
import { extractFingerprint, computeDistance } from '../services/processingEstimator';
import type { AudioFingerprint } from '../types/estimator';

  describe('computeDistance', () => {
    test('returns 0 for identical fingerprints', () => {
      const fp: AudioFingerprint = {
        integratedLufs: -16,
        loudnessRange: 10,
        silenceRatio: 0.1,
        spectralCentroid: 3000,
        spectralFlatness: 0.4,
      };

      const distance = computeDistance(fp, fp);
      expect(distance).toBe(0);
    });

    test('returns value between 0 and 1', () => {
      const fp1: AudioFingerprint = {
        integratedLufs: -60,
        loudnessRange: 0,
        silenceRatio: 0,
        spectralCentroid: 100,
        spectralFlatness: 0,
      };
      const fp2: AudioFingerprint = {
        integratedLufs: 0,
        loudnessRange: 30,
        silenceRatio: 1,
        spectralCentroid: 8000,
        spectralFlatness: 1,
      };

      const distance = computeDistance(fp1, fp2);
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(1);
    });

    test('symmetric: distance(a,b) equals distance(b,a)', () => {
      const fp1: AudioFingerprint = {
        integratedLufs: -20,
        loudnessRange: 8,
        silenceRatio: 0.15,
        spectralCentroid: 2000,
        spectralFlatness: 0.3,
      };
      const fp2: AudioFingerprint = {
        integratedLufs: -14,
        loudnessRange: 12,
        silenceRatio: 0.05,
        spectralCentroid: 4000,
        spectralFlatness: 0.5,
      };

      expect(computeDistance(fp1, fp2)).toBe(computeDistance(fp2, fp1));
    });

    test('similar speech files have small distance', () => {
      const speech1: AudioFingerprint = {
        integratedLufs: -18,
        loudnessRange: 10,
        silenceRatio: 0.2,
        spectralCentroid: 2500,
        spectralFlatness: 0.45,
      };
      const speech2: AudioFingerprint = {
        integratedLufs: -17,
        loudnessRange: 11,
        silenceRatio: 0.22,
        spectralCentroid: 2600,
        spectralFlatness: 0.48,
      };

      const distance = computeDistance(speech1, speech2);
      expect(distance).toBeLessThan(0.1);
    });

    test('different content types have larger distance', () => {
      const speech: AudioFingerprint = {
        integratedLufs: -18,
        loudnessRange: 10,
        silenceRatio: 0.2,
        spectralCentroid: 2500,
        spectralFlatness: 0.5,
      };
      const music: AudioFingerprint = {
        integratedLufs: -10,
        loudnessRange: 6,
        silenceRatio: 0.02,
        spectralCentroid: 1500,
        spectralFlatness: 0.15,
      };

      const distance = computeDistance(speech, music);
      expect(distance).toBeGreaterThan(0.2);
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `cd backend && bun test processingEstimator`
Expected: FAIL with "computeDistance is not a function"

**Step 3: Commit failing tests**

```bash
git add backend/src/__tests__/processingEstimator.test.ts
git commit -m "test(estimator): add failing tests for distance calculation"
```

---

## Task 6: Distance Calculation Implementation

**Files:**
- Modify: `backend/src/services/processingEstimator.ts`

**Step 1: Add distance calculation**

Add to `processingEstimator.ts`:

```typescript
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
```

**Step 2: Run tests to verify they pass**

Run: `cd backend && bun test processingEstimator`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): implement distance calculation with normalization"
```

---

## Task 7: History Storage Tests

**Files:**
- Modify: `backend/src/__tests__/processingEstimator.test.ts`

**Step 1: Add history storage tests**

Add to the test file:

```typescript
import { extractFingerprint, computeDistance, loadHistory, saveOutcome, clearHistory } from '../services/processingEstimator';
import type { ProcessingOutcome } from '../types/estimator';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname } from 'path';

const TEST_HISTORY_PATH = 'data/test-processing-history.json';

  describe('History Storage', () => {
    // Clean up before each test
    beforeEach(() => {
      if (existsSync(TEST_HISTORY_PATH)) {
        rmSync(TEST_HISTORY_PATH);
      }
    });

    afterAll(() => {
      if (existsSync(TEST_HISTORY_PATH)) {
        rmSync(TEST_HISTORY_PATH);
      }
    });

    test('loadHistory returns empty array when file does not exist', () => {
      const history = loadHistory(TEST_HISTORY_PATH);
      expect(history).toEqual([]);
    });

    test('saveOutcome creates file and stores outcome', () => {
      const outcome: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.1,
          spectralCentroid: 2500,
          spectralFlatness: 0.4,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };

      saveOutcome(outcome, TEST_HISTORY_PATH);

      const history = loadHistory(TEST_HISTORY_PATH);
      expect(history).toHaveLength(1);
      expect(history[0].winnerCandidateId).toBe('conservative-speech');
    });

    test('saveOutcome appends to existing history', () => {
      const outcome1: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.1,
          spectralCentroid: 2500,
          spectralFlatness: 0.4,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };
      const outcome2: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -14,
          loudnessRange: 8,
          silenceRatio: 0.02,
          spectralCentroid: 1500,
          spectralFlatness: 0.2,
        },
        winnerCandidateId: 'minimal-music',
        winnerAggressiveness: 'conservative',
        contentType: 'music',
        timestamp: Date.now(),
      };

      saveOutcome(outcome1, TEST_HISTORY_PATH);
      saveOutcome(outcome2, TEST_HISTORY_PATH);

      const history = loadHistory(TEST_HISTORY_PATH);
      expect(history).toHaveLength(2);
    });

    test('clearHistory removes all entries', () => {
      const outcome: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.1,
          spectralCentroid: 2500,
          spectralFlatness: 0.4,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };

      saveOutcome(outcome, TEST_HISTORY_PATH);
      clearHistory(TEST_HISTORY_PATH);

      const history = loadHistory(TEST_HISTORY_PATH);
      expect(history).toEqual([]);
    });
  });
```

Also add imports at top:

```typescript
import { beforeEach, afterAll } from 'bun:test';
```

**Step 2: Run test to verify it fails**

Run: `cd backend && bun test processingEstimator`
Expected: FAIL with "loadHistory is not a function" or similar

**Step 3: Commit failing tests**

```bash
git add backend/src/__tests__/processingEstimator.test.ts
git commit -m "test(estimator): add failing tests for history storage"
```

---

## Task 8: History Storage Implementation

**Files:**
- Modify: `backend/src/services/processingEstimator.ts`

**Step 1: Add history storage functions**

Add imports and functions to `processingEstimator.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ProcessingOutcome } from '../types/estimator';

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
```

**Step 2: Run tests to verify they pass**

Run: `cd backend && bun test processingEstimator`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): implement history storage with JSON file"
```

---

## Task 9: Similarity Matching Tests

**Files:**
- Modify: `backend/src/__tests__/processingEstimator.test.ts`

**Step 1: Add similarity matching tests**

Add to the test file:

```typescript
import { 
  extractFingerprint, 
  computeDistance, 
  loadHistory, 
  saveOutcome, 
  clearHistory,
  findSimilar 
} from '../services/processingEstimator';
import type { EstimatorConfig } from '../types/estimator';

const TEST_CONFIG: EstimatorConfig = {
  historyPath: TEST_HISTORY_PATH,
  statsPath: 'data/test-estimator-stats.json',
  highThreshold: 0.05,
  moderateThreshold: 0.15,
  maxHistory: 10000,
  enabled: true,
};

  describe('findSimilar', () => {
    beforeEach(() => {
      clearHistory(TEST_HISTORY_PATH);
    });

    test('returns null when history is empty', () => {
      const fingerprint: AudioFingerprint = {
        integratedLufs: -16,
        loudnessRange: 10,
        silenceRatio: 0.1,
        spectralCentroid: 2500,
        spectralFlatness: 0.4,
      };

      const match = findSimilar(fingerprint, TEST_CONFIG);
      expect(match).toBeNull();
    });

    test('returns high confidence for very similar fingerprint', () => {
      // Add a history entry
      const outcome: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.1,
          spectralCentroid: 2500,
          spectralFlatness: 0.4,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };
      saveOutcome(outcome, TEST_HISTORY_PATH);

      // Query with nearly identical fingerprint
      const query: AudioFingerprint = {
        integratedLufs: -16.1,
        loudnessRange: 10.05,
        silenceRatio: 0.1,
        spectralCentroid: 2510,
        spectralFlatness: 0.41,
      };

      const match = findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.confidence).toBe('high');
      expect(match!.predictedWinner).toBe('conservative-speech');
    });

    test('returns moderate confidence for somewhat similar fingerprint', () => {
      const outcome: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.1,
          spectralCentroid: 2500,
          spectralFlatness: 0.4,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };
      saveOutcome(outcome, TEST_HISTORY_PATH);

      // Query with moderately different fingerprint
      const query: AudioFingerprint = {
        integratedLufs: -18,
        loudnessRange: 12,
        silenceRatio: 0.15,
        spectralCentroid: 2800,
        spectralFlatness: 0.45,
      };

      const match = findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.confidence).toBe('moderate');
    });

    test('returns null for dissimilar fingerprint', () => {
      const outcome: ProcessingOutcome = {
        fingerprint: {
          integratedLufs: -16,
          loudnessRange: 10,
          silenceRatio: 0.2,
          spectralCentroid: 2500,
          spectralFlatness: 0.5,
        },
        winnerCandidateId: 'conservative-speech',
        winnerAggressiveness: 'conservative',
        contentType: 'speech',
        timestamp: Date.now(),
      };
      saveOutcome(outcome, TEST_HISTORY_PATH);

      // Query with very different fingerprint (music-like)
      const query: AudioFingerprint = {
        integratedLufs: -8,
        loudnessRange: 5,
        silenceRatio: 0.01,
        spectralCentroid: 1000,
        spectralFlatness: 0.1,
      };

      const match = findSimilar(query, TEST_CONFIG);
      expect(match).toBeNull();
    });

    test('matchCount reflects number of agreeing history entries', () => {
      // Add 3 similar entries with same winner
      for (let i = 0; i < 3; i++) {
        const outcome: ProcessingOutcome = {
          fingerprint: {
            integratedLufs: -16 + i * 0.1,
            loudnessRange: 10,
            silenceRatio: 0.1,
            spectralCentroid: 2500,
            spectralFlatness: 0.4,
          },
          winnerCandidateId: 'conservative-speech',
          winnerAggressiveness: 'conservative',
          contentType: 'speech',
          timestamp: Date.now(),
        };
        saveOutcome(outcome, TEST_HISTORY_PATH);
      }

      const query: AudioFingerprint = {
        integratedLufs: -16,
        loudnessRange: 10,
        silenceRatio: 0.1,
        spectralCentroid: 2500,
        spectralFlatness: 0.4,
      };

      const match = findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.matchCount).toBeGreaterThanOrEqual(1);
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `cd backend && bun test processingEstimator`
Expected: FAIL with "findSimilar is not a function"

**Step 3: Commit failing tests**

```bash
git add backend/src/__tests__/processingEstimator.test.ts
git commit -m "test(estimator): add failing tests for similarity matching"
```

---

## Task 10: Similarity Matching Implementation

**Files:**
- Modify: `backend/src/services/processingEstimator.ts`

**Step 1: Add similarity matching function**

Add to `processingEstimator.ts`:

```typescript
import type { AudioFingerprint, ProcessingOutcome, SimilarMatch, EstimatorConfig } from '../types/estimator';

/**
 * Find similar historical processing outcomes
 */
export function findSimilar(
  fingerprint: AudioFingerprint,
  config: EstimatorConfig
): SimilarMatch | null {
  const history = loadHistory(config.historyPath);
  
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
```

**Step 2: Run tests to verify they pass**

Run: `cd backend && bun test processingEstimator`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): implement similarity matching with confidence tiers"
```

---

## Task 11: Stats Tracking Tests

**Files:**
- Modify: `backend/src/__tests__/processingEstimator.test.ts`

**Step 1: Add stats tracking tests**

Add to the test file:

```typescript
import { 
  // ... existing imports
  loadStats,
  recordPredictionResult,
} from '../services/processingEstimator';
import type { EstimatorStats } from '../types/estimator';

const TEST_STATS_PATH = 'data/test-estimator-stats.json';

  describe('Stats Tracking', () => {
    beforeEach(() => {
      if (existsSync(TEST_STATS_PATH)) {
        rmSync(TEST_STATS_PATH);
      }
    });

    afterAll(() => {
      if (existsSync(TEST_STATS_PATH)) {
        rmSync(TEST_STATS_PATH);
      }
    });

    test('loadStats returns zeros when file does not exist', () => {
      const stats = loadStats(TEST_STATS_PATH);
      expect(stats.totalPredictions).toBe(0);
      expect(stats.highConfidenceHits).toBe(0);
      expect(stats.highConfidenceMisses).toBe(0);
    });

    test('recordPredictionResult increments high confidence hit', () => {
      recordPredictionResult('high', true, TEST_STATS_PATH);
      
      const stats = loadStats(TEST_STATS_PATH);
      expect(stats.totalPredictions).toBe(1);
      expect(stats.highConfidenceHits).toBe(1);
      expect(stats.highConfidenceMisses).toBe(0);
    });

    test('recordPredictionResult increments moderate confidence miss', () => {
      recordPredictionResult('moderate', false, TEST_STATS_PATH);
      
      const stats = loadStats(TEST_STATS_PATH);
      expect(stats.totalPredictions).toBe(1);
      expect(stats.moderateConfidenceHits).toBe(0);
      expect(stats.moderateConfidenceMisses).toBe(1);
    });

    test('stats accumulate across multiple calls', () => {
      recordPredictionResult('high', true, TEST_STATS_PATH);
      recordPredictionResult('high', true, TEST_STATS_PATH);
      recordPredictionResult('high', false, TEST_STATS_PATH);
      recordPredictionResult('moderate', true, TEST_STATS_PATH);
      
      const stats = loadStats(TEST_STATS_PATH);
      expect(stats.totalPredictions).toBe(4);
      expect(stats.highConfidenceHits).toBe(2);
      expect(stats.highConfidenceMisses).toBe(1);
      expect(stats.moderateConfidenceHits).toBe(1);
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `cd backend && bun test processingEstimator`
Expected: FAIL with "loadStats is not a function"

**Step 3: Commit failing tests**

```bash
git add backend/src/__tests__/processingEstimator.test.ts
git commit -m "test(estimator): add failing tests for stats tracking"
```

---

## Task 12: Stats Tracking Implementation

**Files:**
- Modify: `backend/src/services/processingEstimator.ts`

**Step 1: Add stats tracking functions**

Add to `processingEstimator.ts`:

```typescript
import type { EstimatorStats } from '../types/estimator';

/**
 * Load estimator stats from file
 */
export function loadStats(statsPath: string): EstimatorStats {
  if (!existsSync(statsPath)) {
    return {
      totalPredictions: 0,
      highConfidenceHits: 0,
      highConfidenceMisses: 0,
      moderateConfidenceHits: 0,
      moderateConfidenceMisses: 0,
      lastUpdated: 0,
    };
  }

  try {
    const content = readFileSync(statsPath, 'utf-8');
    return JSON.parse(content) as EstimatorStats;
  } catch {
    return {
      totalPredictions: 0,
      highConfidenceHits: 0,
      highConfidenceMisses: 0,
      moderateConfidenceHits: 0,
      moderateConfidenceMisses: 0,
      lastUpdated: 0,
    };
  }
}

/**
 * Record a prediction result for stats tracking
 */
export function recordPredictionResult(
  confidence: 'high' | 'moderate',
  correct: boolean,
  statsPath: string
): void {
  const dir = dirname(statsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const stats = loadStats(statsPath);
  
  stats.totalPredictions++;
  
  if (confidence === 'high') {
    if (correct) {
      stats.highConfidenceHits++;
    } else {
      stats.highConfidenceMisses++;
    }
  } else {
    if (correct) {
      stats.moderateConfidenceHits++;
    } else {
      stats.moderateConfidenceMisses++;
    }
  }
  
  stats.lastUpdated = Date.now();
  
  writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}
```

**Step 2: Run tests to verify they pass**

Run: `cd backend && bun test processingEstimator`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): implement stats tracking for prediction accuracy"
```

---

## Task 13: Config Helper and Logging

**Files:**
- Modify: `backend/src/services/processingEstimator.ts`

**Step 1: Add config helper and logging**

Add to the top of `processingEstimator.ts`:

```typescript
import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger({ service: 'processingEstimator' });

/**
 * Get estimator config from environment
 */
export function getEstimatorConfig(): EstimatorConfig {
  return {
    historyPath: env.ESTIMATOR_HISTORY_PATH,
    statsPath: env.ESTIMATOR_STATS_PATH,
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
```

**Step 2: Run type check**

Run: `cd backend && bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/services/processingEstimator.ts
git commit -m "feat(estimator): add config helper and logging"
```

---

## Task 14: Integration into Intelligent Processor

**Files:**
- Modify: `backend/src/services/intelligentProcessor.ts`

**Step 1: Add imports**

Add at the top of `intelligentProcessor.ts`:

```typescript
import {
  extractFingerprint,
  findSimilar,
  saveOutcome,
  getEstimatorConfig,
  logPrediction,
  recordPredictionResult,
} from './processingEstimator';
import type { AudioFingerprint, SimilarMatch, ProcessingOutcome } from '../types/estimator';
```

**Step 2: Add estimation check after analysis**

In `runIntelligentProcessing`, after the analysis section (around line 118), add:

```typescript
    // Check estimation before generating candidates
    const estimatorConfig = getEstimatorConfig();
    let prediction: SimilarMatch | null = null;
    let fingerprint: AudioFingerprint | null = null;
    
    if (estimatorConfig.enabled) {
      fingerprint = extractFingerprint(analysis.metrics);
      prediction = findSimilar(fingerprint, estimatorConfig);
      
      if (prediction) {
        processorLog.info({
          confidence: prediction.confidence,
          predictedWinner: prediction.predictedWinner,
          distance: prediction.distance,
          matchCount: prediction.matchCount,
        }, 'Found similar historical file');
      }
    }
```

**Step 3: Modify candidate generation based on prediction**

Replace the candidate generation section with:

```typescript
    // Stage 2: Generate candidates (may be reduced based on prediction)
    callbacks?.onStage?.('Generating processing strategies...');

    let { candidates, reasoning } = generateCandidates(analysis);
    
    // If high confidence prediction, only run the predicted winner
    if (prediction?.confidence === 'high') {
      const predictedCandidate = candidates.find(c => c.id === prediction.predictedWinner);
      if (predictedCandidate) {
        candidates = [predictedCandidate];
        processorLog.info({ candidateId: predictedCandidate.id }, 'High confidence: using single predicted candidate');
      }
    }
    // If moderate confidence, run predicted + one alternative
    else if (prediction?.confidence === 'moderate') {
      const predictedCandidate = candidates.find(c => c.id === prediction.predictedWinner);
      const alternative = candidates.find(c => c.id !== prediction.predictedWinner);
      if (predictedCandidate && alternative) {
        candidates = [predictedCandidate, alternative];
        processorLog.info(
          { predictedId: predictedCandidate.id, alternativeId: alternative.id },
          'Moderate confidence: using predicted + alternative'
        );
      }
    }

    processorLog.info({ candidateCount: candidates.length }, 'Candidates generated');
```

**Step 4: Record outcome after winner selection**

After the winner is selected (around line 185), add:

```typescript
    // Record outcome for future estimation
    if (estimatorConfig.enabled && fingerprint) {
      const actualWinner = candidates.find(c => c.id === evaluation.winnerId);
      
      const outcome: ProcessingOutcome = {
        fingerprint,
        winnerCandidateId: evaluation.winnerId,
        winnerAggressiveness: actualWinner?.aggressiveness ?? 'balanced',
        contentType: analysis.contentType.type,
        timestamp: Date.now(),
        wasPredicted: prediction !== null,
        predictionCorrect: prediction ? prediction.predictedWinner === evaluation.winnerId : undefined,
      };
      
      saveOutcome(outcome, estimatorConfig.historyPath, estimatorConfig.maxHistory);
      
      // Log and record prediction result if we made a prediction
      if (prediction) {
        logPrediction(
          prediction.predictedWinner,
          evaluation.winnerId,
          prediction.confidence,
          prediction.distance
        );
        recordPredictionResult(
          prediction.confidence,
          prediction.predictedWinner === evaluation.winnerId,
          estimatorConfig.statsPath
        );
      }
    }
```

**Step 5: Run type check**

Run: `cd backend && bun run typecheck`
Expected: PASS

**Step 6: Run all tests**

Run: `cd backend && bun test`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/src/services/intelligentProcessor.ts
git commit -m "feat(estimator): integrate estimation into intelligent processing pipeline"
```

---

## Task 15: Add Report Fields for Estimation

**Files:**
- Modify: `backend/src/services/intelligentProcessor.ts`

**Step 1: Update ProcessingReport interface**

Add to the `ProcessingReport` interface in `intelligentProcessor.ts`:

```typescript
  /** Whether this result was estimated from similar file */
  wasEstimated?: boolean;
  /** Estimation confidence level */
  estimationConfidence?: 'high' | 'moderate';
  /** Distance to closest historical match */
  estimationDistance?: number;
```

**Step 2: Update buildProcessingReport function**

Add parameters and include estimation info:

```typescript
function buildProcessingReport(
  analysis: AnalysisResult,
  evaluation: EvaluationResult,
  candidates: ProcessingCandidate[],
  winner: ProcessingCandidate | undefined,
  winnerScore: CandidateScore | undefined,
  prediction?: SimilarMatch | null
): ProcessingReport {
  // ... existing code ...
  
  return {
    // ... existing fields ...
    wasEstimated: prediction !== null && prediction !== undefined,
    estimationConfidence: prediction?.confidence,
    estimationDistance: prediction?.distance,
  };
}
```

**Step 3: Update the call to buildProcessingReport**

Pass prediction to the function:

```typescript
    const processingReport = buildProcessingReport(
      analysis,
      evaluation,
      candidates,
      winner,
      winnerScore,
      prediction
    );
```

**Step 4: Run type check**

Run: `cd backend && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/intelligentProcessor.ts
git commit -m "feat(estimator): add estimation info to processing report"
```

---

## Task 16: Ensure Data Directory Exists

**Files:**
- Modify: `backend/src/index.ts`

**Step 1: Add data directory check at startup**

Add near the top of the main startup section:

```typescript
import { mkdirSync, existsSync } from 'fs';

// Ensure data directory exists for estimator
const dataDir = 'data';
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
```

**Step 2: Run the backend**

Run: `cd backend && bun run dev`
Expected: Server starts without errors

**Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(estimator): ensure data directory exists at startup"
```

---

## Task 17: Final Integration Test

**Files:**
- Create: `backend/src/__tests__/estimatorIntegration.test.ts`

**Step 1: Write integration test**

```typescript
// backend/src/__tests__/estimatorIntegration.test.ts
import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import {
  extractFingerprint,
  computeDistance,
  findSimilar,
  saveOutcome,
  loadHistory,
  clearHistory,
  loadStats,
  recordPredictionResult,
  getEstimatorConfig,
} from '../services/processingEstimator';
import type { AnalysisMetrics } from '../types/analysis';
import type { ProcessingOutcome, EstimatorConfig } from '../types/estimator';

const TEST_HISTORY_PATH = 'data/integration-test-history.json';
const TEST_STATS_PATH = 'data/integration-test-stats.json';

const TEST_CONFIG: EstimatorConfig = {
  historyPath: TEST_HISTORY_PATH,
  statsPath: TEST_STATS_PATH,
  highThreshold: 0.05,
  moderateThreshold: 0.15,
  maxHistory: 100,
  enabled: true,
};

describe('Estimator Integration', () => {
  beforeEach(() => {
    if (existsSync(TEST_HISTORY_PATH)) rmSync(TEST_HISTORY_PATH);
    if (existsSync(TEST_STATS_PATH)) rmSync(TEST_STATS_PATH);
  });

  afterAll(() => {
    if (existsSync(TEST_HISTORY_PATH)) rmSync(TEST_HISTORY_PATH);
    if (existsSync(TEST_STATS_PATH)) rmSync(TEST_STATS_PATH);
  });

  test('full workflow: process similar files with estimation', () => {
    // Simulate first file processing (no history)
    const metrics1: AnalysisMetrics = {
      channels: 2,
      sampleRate: 48000,
      bitDepth: 24,
      duration: 120,
      integratedLufs: -18,
      loudnessRange: 10,
      truePeak: -1.5,
      rmsDb: -20,
      peakDb: -3,
      crestFactor: 17,
      silenceRatio: 0.15,
      leadingSilence: 0.5,
      trailingSilence: 0.3,
      spectralCentroid: 2500,
      spectralFlatness: 0.45,
      lowFreqEnergy: 0.2,
      midFreqEnergy: 0.5,
      highFreqEnergy: 0.2,
      veryHighFreqEnergy: 0.1,
      flatFactor: 0.01,
      peakCount: 5,
      dcOffset: 0.001,
      stereoBalance: 0.5,
    };

    const fp1 = extractFingerprint(metrics1);
    
    // No prediction for first file
    const prediction1 = findSimilar(fp1, TEST_CONFIG);
    expect(prediction1).toBeNull();

    // Save outcome (simulating processing result)
    const outcome1: ProcessingOutcome = {
      fingerprint: fp1,
      winnerCandidateId: 'conservative-speech',
      winnerAggressiveness: 'conservative',
      contentType: 'speech',
      timestamp: Date.now(),
    };
    saveOutcome(outcome1, TEST_HISTORY_PATH);

    // Second similar file should get high confidence prediction
    const metrics2: AnalysisMetrics = {
      ...metrics1,
      integratedLufs: -17.8,
      silenceRatio: 0.16,
      spectralCentroid: 2550,
    };

    const fp2 = extractFingerprint(metrics2);
    const prediction2 = findSimilar(fp2, TEST_CONFIG);

    expect(prediction2).not.toBeNull();
    expect(prediction2!.confidence).toBe('high');
    expect(prediction2!.predictedWinner).toBe('conservative-speech');

    // Record hit
    recordPredictionResult('high', true, TEST_STATS_PATH);

    const stats = loadStats(TEST_STATS_PATH);
    expect(stats.totalPredictions).toBe(1);
    expect(stats.highConfidenceHits).toBe(1);
  });

  test('different content produces no match', () => {
    // Save speech outcome
    const speechOutcome: ProcessingOutcome = {
      fingerprint: {
        integratedLufs: -18,
        loudnessRange: 10,
        silenceRatio: 0.2,
        spectralCentroid: 2500,
        spectralFlatness: 0.5,
      },
      winnerCandidateId: 'conservative-speech',
      winnerAggressiveness: 'conservative',
      contentType: 'speech',
      timestamp: Date.now(),
    };
    saveOutcome(speechOutcome, TEST_HISTORY_PATH);

    // Query with music-like fingerprint
    const musicFp = {
      integratedLufs: -10,
      loudnessRange: 5,
      silenceRatio: 0.02,
      spectralCentroid: 1200,
      spectralFlatness: 0.15,
    };

    const prediction = findSimilar(musicFp, TEST_CONFIG);
    expect(prediction).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `cd backend && bun test estimatorIntegration`
Expected: PASS

**Step 3: Run all tests**

Run: `cd backend && bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/__tests__/estimatorIntegration.test.ts
git commit -m "test(estimator): add integration tests for full estimation workflow"
```

---

## Task 18: Final Verification

**Step 1: Run all backend tests**

Run: `cd backend && bun test`
Expected: All tests PASS

**Step 2: Run type check**

Run: `cd backend && bun run typecheck`
Expected: No errors

**Step 3: Create final commit summarizing feature**

```bash
git add -A
git commit -m "feat: complete processing estimator implementation

- Add fingerprinting based on 5 core audio metrics
- Add distance calculation with normalization
- Add history storage in JSON file
- Add similarity matching with confidence tiers
- Add accuracy tracking for threshold tuning
- Integrate into intelligent processing pipeline
- Add comprehensive test suite"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Type definitions | - |
| 2 | Environment config | - |
| 3-4 | Fingerprint extraction | 1 test |
| 5-6 | Distance calculation | 5 tests |
| 7-8 | History storage | 4 tests |
| 9-10 | Similarity matching | 5 tests |
| 11-12 | Stats tracking | 4 tests |
| 13 | Config helper + logging | - |
| 14 | Pipeline integration | - |
| 15 | Report fields | - |
| 16 | Data directory | - |
| 17 | Integration tests | 2 tests |
| 18 | Final verification | - |

**Total: 18 tasks, ~21 tests**
