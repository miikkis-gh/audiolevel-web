import { describe, expect, test, beforeEach } from 'bun:test';
import { extractFingerprint, computeDistance, loadHistory, saveOutcome, clearHistory, findSimilar, loadStats, recordPredictionResult } from '../services/processingEstimator';
import type { AudioFingerprint, ProcessingOutcome, EstimatorConfig } from '../types/estimator';
import type { AnalysisMetrics } from '../types/analysis';
import { getRedisClient } from '../services/redis';

const TEST_CONFIG: EstimatorConfig = {
  highThreshold: 0.05,
  moderateThreshold: 0.15,
  maxHistory: 10000,
  enabled: true,
};

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

  describe('History Storage (Redis)', () => {
    beforeEach(async () => {
      await clearHistory();
    });

    test('loadHistory returns empty array when no data exists', async () => {
      const history = await loadHistory();
      expect(history).toEqual([]);
    });

    test('saveOutcome stores outcome', async () => {
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

      await saveOutcome(outcome);

      const history = await loadHistory();
      expect(history).toHaveLength(1);
      expect(history[0].winnerCandidateId).toBe('conservative-speech');
    });

    test('saveOutcome appends to existing history', async () => {
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

      await saveOutcome(outcome1);
      await saveOutcome(outcome2);

      const history = await loadHistory();
      expect(history).toHaveLength(2);
    });

    test('clearHistory removes all entries', async () => {
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

      await saveOutcome(outcome);
      await clearHistory();

      const history = await loadHistory();
      expect(history).toEqual([]);
    });
  });

  describe('findSimilar', () => {
    beforeEach(async () => {
      await clearHistory();
    });

    test('returns null when history is empty', async () => {
      const fingerprint: AudioFingerprint = {
        integratedLufs: -16,
        loudnessRange: 10,
        silenceRatio: 0.1,
        spectralCentroid: 2500,
        spectralFlatness: 0.4,
      };

      const match = await findSimilar(fingerprint, TEST_CONFIG);
      expect(match).toBeNull();
    });

    test('returns high confidence for very similar fingerprint', async () => {
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
      await saveOutcome(outcome);

      const query: AudioFingerprint = {
        integratedLufs: -16.1,
        loudnessRange: 10.05,
        silenceRatio: 0.1,
        spectralCentroid: 2510,
        spectralFlatness: 0.41,
      };

      const match = await findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.confidence).toBe('high');
      expect(match!.predictedWinner).toBe('conservative-speech');
    });

    test('returns moderate confidence for somewhat similar fingerprint', async () => {
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
      await saveOutcome(outcome);

      // Fingerprint with distance ~0.08 (between high=0.05 and moderate=0.15)
      const query: AudioFingerprint = {
        integratedLufs: -20,
        loudnessRange: 14,
        silenceRatio: 0.18,
        spectralCentroid: 3000,
        spectralFlatness: 0.5,
      };

      const match = await findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.confidence).toBe('moderate');
    });

    test('returns null for dissimilar fingerprint', async () => {
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
      await saveOutcome(outcome);

      const query: AudioFingerprint = {
        integratedLufs: -8,
        loudnessRange: 5,
        silenceRatio: 0.01,
        spectralCentroid: 1000,
        spectralFlatness: 0.1,
      };

      const match = await findSimilar(query, TEST_CONFIG);
      expect(match).toBeNull();
    });

    test('matchCount reflects number of agreeing history entries', async () => {
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
        await saveOutcome(outcome);
      }

      const query: AudioFingerprint = {
        integratedLufs: -16,
        loudnessRange: 10,
        silenceRatio: 0.1,
        spectralCentroid: 2500,
        spectralFlatness: 0.4,
      };

      const match = await findSimilar(query, TEST_CONFIG);
      expect(match).not.toBeNull();
      expect(match!.matchCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Stats Tracking (Redis)', () => {
    beforeEach(async () => {
      const redis = getRedisClient();
      await redis.del('estimator:stats');
    });

    test('loadStats returns zeros when no data exists', async () => {
      const stats = await loadStats();
      expect(stats.totalPredictions).toBe(0);
      expect(stats.highConfidenceHits).toBe(0);
      expect(stats.highConfidenceMisses).toBe(0);
    });

    test('recordPredictionResult increments high confidence hit', async () => {
      await recordPredictionResult('high', true);

      const stats = await loadStats();
      expect(stats.totalPredictions).toBe(1);
      expect(stats.highConfidenceHits).toBe(1);
      expect(stats.highConfidenceMisses).toBe(0);
    });

    test('recordPredictionResult increments moderate confidence miss', async () => {
      await recordPredictionResult('moderate', false);

      const stats = await loadStats();
      expect(stats.totalPredictions).toBe(1);
      expect(stats.moderateConfidenceHits).toBe(0);
      expect(stats.moderateConfidenceMisses).toBe(1);
    });

    test('stats accumulate across multiple calls', async () => {
      await recordPredictionResult('high', true);
      await recordPredictionResult('high', true);
      await recordPredictionResult('high', false);
      await recordPredictionResult('moderate', true);

      const stats = await loadStats();
      expect(stats.totalPredictions).toBe(4);
      expect(stats.highConfidenceHits).toBe(2);
      expect(stats.highConfidenceMisses).toBe(1);
      expect(stats.moderateConfidenceHits).toBe(1);
    });
  });
});
