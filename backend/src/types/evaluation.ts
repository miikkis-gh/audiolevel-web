/**
 * Types for audio quality evaluation
 *
 * @module types/evaluation
 */

import type { ContentType } from './analysis';

/**
 * Metrics measured on a processed candidate
 */
export interface CandidateMetrics {
  /** Integrated loudness (LUFS) */
  integratedLufs: number;

  /** Loudness range (LRA in LU) */
  loudnessRange: number;

  /** True peak (dBTP) */
  truePeak: number;

  /** ViSQOL perceptual quality score (1-5 MOS) */
  visqolScore: number;

  /** Signal-to-noise ratio estimate (dB) */
  snrEstimate: number;
}

/**
 * Score breakdown for a candidate
 */
export interface CandidateScore {
  candidateId: string;
  candidateName: string;

  /** Individual metric scores (0-100) */
  scores: {
    loudnessAccuracy: number;
    dynamicRange: number;
    peakSafety: number;
    noiseReduction: number;
    perceptualQuality: number;
  };

  /** Weighted total score (0-100) */
  totalScore: number;

  /** Raw metrics */
  metrics: CandidateMetrics;

  /** Whether this candidate passed safety checks */
  passedSafety: boolean;

  /** Reason for rejection if failed safety */
  rejectionReason?: string;
}

/**
 * Result of candidate evaluation
 */
export interface EvaluationResult {
  /** ID of the winning candidate */
  winnerId: string;

  /** Name of the winning candidate */
  winnerName: string;

  /** Human-readable explanation of why the winner won */
  winnerReason: string;

  /** All candidate scores */
  candidates: CandidateScore[];

  /** Content type used for scoring weights */
  contentType: ContentType;
}

/**
 * Weights for scoring by content type
 */
export interface ScoringWeights {
  loudnessAccuracy: number;
  dynamicRange: number;
  peakSafety: number;
  noiseReduction: number;
  perceptualQuality: number;
}

/**
 * Configuration for evaluation
 */
export interface EvaluationConfig {
  /** Target LUFS for loudness accuracy scoring */
  targetLufs: number;

  /** Target true peak (dBTP) */
  targetTruePeak: number;

  /** Acceptable LRA range [min, max] */
  acceptableLraRange: [number, number];

  /** Minimum ViSQOL score to pass (1-5) */
  minimumVisqol: number;

  /** Maximum true peak to pass (dBTP) */
  maximumTruePeak: number;

  /** Input SNR estimate for improvement calculation */
  inputSnrEstimate: number;
}
