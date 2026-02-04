/**
 * Types for processing candidates
 *
 * @module types/candidate
 */

import type { ContentType, AudioProblems, AnalysisMetrics } from './analysis';

/** Processing aggressiveness level */
export type AggressivenessLevel = 'conservative' | 'balanced' | 'aggressive';

/**
 * A processing candidate configuration
 */
export interface ProcessingCandidate {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of the processing approach */
  description: string;

  /** Aggressiveness level */
  aggressiveness: AggressivenessLevel;

  /** Complete FFmpeg filter chain string */
  filterChain: string;

  /** Individual filters applied (for reporting) */
  filtersApplied: string[];

  /** Target loudness (LUFS) */
  targetLufs: number;

  /** Target true peak (dBTP) */
  targetTruePeak: number;
}

/**
 * Configuration for building filter chains
 */
export interface FilterConfig {
  /** High-pass filter cutoff frequency */
  highpassFreq: number;

  /** Noise reduction strength (anlmdn 's' parameter, 0-15) */
  noiseReductionStrength: number;

  /** Whether to apply noise reduction */
  applyNoiseReduction: boolean;

  /** EQ cut for muddiness (dB, negative value) */
  mudCutDb: number;

  /** Whether to apply mud cut */
  applyMudCut: boolean;

  /** Whether to apply de-esser */
  applyDeesser: boolean;

  /** De-esser intensity (0-1) */
  deesserIntensity: number;

  /** Whether to apply compression */
  applyCompression: boolean;

  /** Compression ratio */
  compressionRatio: number;

  /** Compression threshold (dB) */
  compressionThreshold: number;

  /** Compression attack (ms) */
  compressionAttack: number;

  /** Compression release (ms) */
  compressionRelease: number;

  /** Whether to use dynaudnorm instead of compression */
  useDynaudnorm: boolean;

  /** Dynaudnorm frame length */
  dynaudnormFrameLen: number;

  /** Target LUFS for loudnorm */
  targetLufs: number;

  /** Target true peak for loudnorm */
  targetTruePeak: number;

  /** Target LRA for loudnorm */
  targetLra: number;
}

/**
 * Result of candidate generation
 */
export interface CandidateGenerationResult {
  /** Content type used for generation */
  contentType: ContentType;

  /** Generated candidates */
  candidates: ProcessingCandidate[];

  /** Reasoning for candidate selection */
  reasoning: string;
}
