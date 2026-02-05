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
