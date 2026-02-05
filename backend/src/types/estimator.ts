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
