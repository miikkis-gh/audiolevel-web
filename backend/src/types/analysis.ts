/**
 * Types for intelligent audio analysis
 *
 * @module types/analysis
 */

/** Severity levels for detected problems */
export type Severity = 'none' | 'mild' | 'moderate' | 'severe';

/** Content types that can be detected */
export type ContentType = 'speech' | 'music' | 'podcast_mixed' | 'unknown';

/**
 * Result of content type classification
 */
export interface ContentClassification {
  type: ContentType;
  confidence: number; // 0-1
  signals: ContentSignal[];
}

/**
 * Signal used in content classification
 */
export interface ContentSignal {
  name: string;
  value: number;
  indicates: ContentType;
  weight: number;
}

/**
 * Detected audio problems
 */
export interface AudioProblems {
  clipping: {
    detected: boolean;
    severity: Severity;
    peakCount: number;
    flatFactor: number;
  };
  noiseFloor: {
    detected: boolean;
    severity: Severity;
    levelDb: number;
  };
  dcOffset: {
    detected: boolean;
    value: number;
  };
  lowLoudness: {
    detected: boolean;
    integratedLufs: number;
  };
  excessiveDynamicRange: {
    detected: boolean;
    severity: Severity;
    lra: number;
  };
  sibilance: {
    detected: boolean;
    severity: Severity;
    energyRatio: number;
  };
  muddiness: {
    detected: boolean;
    severity: Severity;
    energyRatio: number;
  };
  stereoImbalance: {
    detected: boolean;
    differenceDb: number;
  };
  silencePadding: {
    detected: boolean;
    startSeconds: number;
    endSeconds: number;
  };
}

/**
 * Raw metrics from audio analysis
 */
export interface AnalysisMetrics {
  // Basic metadata
  channels: number;
  sampleRate: number;
  bitDepth: number;
  duration: number;

  // Loudness metrics
  integratedLufs: number;
  loudnessRange: number; // LRA
  truePeak: number;

  // Dynamics
  rmsDb: number;
  peakDb: number;
  crestFactor: number;

  // Silence analysis
  silenceRatio: number;
  leadingSilence: number;
  trailingSilence: number;

  // Spectral analysis
  spectralCentroid: number;
  spectralFlatness: number;
  lowFreqEnergy: number; // 20-300Hz
  midFreqEnergy: number; // 300-4000Hz
  highFreqEnergy: number; // 4000-8000Hz
  veryHighFreqEnergy: number; // 8000-20000Hz

  // Clipping indicators
  flatFactor: number;
  peakCount: number;

  // DC offset
  dcOffset: number;

  // Stereo
  stereoBalance: number; // L-R difference in dB
}

/**
 * Complete analysis result
 */
export interface AnalysisResult {
  /** Content type classification */
  contentType: ContentClassification;

  /** Detected problems */
  problems: AudioProblems;

  /** Raw metrics */
  metrics: AnalysisMetrics;

  /** Human-readable problem descriptions */
  problemDescriptions: { problem: string; details: string }[];
}

/**
 * Thresholds for problem detection
 */
export interface AnalysisThresholds {
  noise: {
    mild: number; // dB
    moderate: number;
    severe: number;
  };
  clipping: {
    peakCount: number;
    flatFactor: number;
  };
  dcOffset: number;
  lowLoudness: number; // LUFS
  dynamicRange: {
    speech: number; // LRA threshold
    music: number;
  };
  sibilance: number; // dB above neighbors
  muddiness: number; // dB above curve
  stereoImbalance: number; // dB
  silencePadding: number; // seconds
}
