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
