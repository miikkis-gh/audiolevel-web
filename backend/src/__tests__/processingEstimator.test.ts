import { describe, expect, test } from 'bun:test';
import { extractFingerprint, computeDistance } from '../services/processingEstimator';
import type { AudioFingerprint } from '../types/estimator';
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
});
