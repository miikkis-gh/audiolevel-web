/**
 * Processing Candidate Generator
 *
 * Generates multiple processing strategies based on content analysis.
 * Each candidate represents a different approach (conservative to aggressive).
 *
 * @module services/candidateGenerator
 */

import { createChildLogger } from '../utils/logger';
import type { AnalysisResult, ContentType } from '../types/analysis';
import type {
  ProcessingCandidate,
  FilterConfig,
  CandidateGenerationResult,
  AggressivenessLevel,
} from '../types/candidate';

const log = createChildLogger({ service: 'candidateGenerator' });

/**
 * Generate processing candidates based on analysis results
 *
 * @param analysis - The analysis result from audioAnalyzer
 * @returns Array of processing candidates to try
 */
export function generateCandidates(analysis: AnalysisResult): CandidateGenerationResult {
  const { contentType, problems, metrics } = analysis;
  const type = contentType.type;

  log.info({ contentType: type, confidence: contentType.confidence }, 'Generating candidates');

  const candidates: ProcessingCandidate[] = [];
  const reasoning: string[] = [];

  // Always generate conservative candidate
  const conservativeConfig = buildConservativeConfig(type, metrics);
  candidates.push(buildCandidate('conservative', conservativeConfig, type));
  reasoning.push('Conservative: minimal processing, loudness normalization only');

  // Generate balanced candidate based on detected problems
  const balancedConfig = buildBalancedConfig(type, problems, metrics);
  candidates.push(buildCandidate('balanced', balancedConfig, type));
  reasoning.push('Balanced: addresses detected issues with moderate settings');

  // Generate aggressive candidate if problems warrant it
  if (hasSignificantProblems(problems)) {
    const aggressiveConfig = buildAggressiveConfig(type, problems, metrics);
    candidates.push(buildCandidate('aggressive', aggressiveConfig, type));
    reasoning.push('Aggressive: stronger correction for detected issues');
  }

  // Generate content-optimized candidate
  const optimizedConfig = buildContentOptimizedConfig(type, problems, metrics);
  candidates.push(buildCandidate('content-optimized', optimizedConfig, type));
  reasoning.push(`Content-optimized: tailored for ${type} content`);

  log.info({ candidateCount: candidates.length }, 'Candidates generated');

  return {
    contentType: type,
    candidates,
    reasoning: reasoning.join('; '),
  };
}

/**
 * Build configuration for conservative processing
 */
function buildConservativeConfig(contentType: ContentType, metrics: any): FilterConfig {
  const isSpeech = contentType === 'speech' || contentType === 'podcast_mixed';

  return {
    highpassFreq: isSpeech ? 80 : 30,
    noiseReductionStrength: 0,
    applyNoiseReduction: false,
    mudCutDb: 0,
    applyMudCut: false,
    applyDeesser: false,
    deesserIntensity: 0,
    applyCompression: false,
    compressionRatio: 1,
    compressionThreshold: 0,
    compressionAttack: 0,
    compressionRelease: 0,
    useDynaudnorm: false,
    dynaudnormFrameLen: 150,
    targetLufs: isSpeech ? -16 : -14,
    targetTruePeak: isSpeech ? -1.5 : -1,
    targetLra: 11,
  };
}

/**
 * Build configuration for balanced processing
 */
function buildBalancedConfig(
  contentType: ContentType,
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  const isSpeech = contentType === 'speech' || contentType === 'podcast_mixed';
  const isMusic = contentType === 'music';

  const config: FilterConfig = {
    highpassFreq: isSpeech ? 80 : 30,
    noiseReductionStrength: 0,
    applyNoiseReduction: false,
    mudCutDb: 0,
    applyMudCut: false,
    applyDeesser: false,
    deesserIntensity: 0.4,
    applyCompression: false,
    compressionRatio: 2,
    compressionThreshold: -20,
    compressionAttack: isSpeech ? 20 : 50,
    compressionRelease: isSpeech ? 200 : 500,
    useDynaudnorm: false,
    dynaudnormFrameLen: 150,
    targetLufs: isSpeech ? -16 : -14,
    targetTruePeak: isSpeech ? -1.5 : -1,
    targetLra: 11,
  };

  // Apply noise reduction if noise detected
  if (problems.noiseFloor.detected) {
    config.applyNoiseReduction = true;
    config.noiseReductionStrength = isSpeech ? 7 : 3;
  }

  // Apply mud cut if muddiness detected
  if (problems.muddiness.detected) {
    config.applyMudCut = true;
    config.mudCutDb = problems.muddiness.severity === 'severe' ? -4 : -2;
  }

  // Apply de-esser for speech with sibilance
  if (isSpeech && problems.sibilance.detected) {
    config.applyDeesser = true;
    config.deesserIntensity = problems.sibilance.severity === 'severe' ? 0.6 : 0.4;
  }

  // For speech: use dynaudnorm for leveling (no pumping)
  if (isSpeech) {
    config.useDynaudnorm = true;
  }

  // For music: only apply gentle compression if LRA is truly excessive (> 20)
  if (isMusic && problems.excessiveDynamicRange.detected && metrics.loudnessRange > 20) {
    config.applyCompression = true;
    config.compressionRatio = 1.5;
    config.compressionThreshold = -6;
  }

  return config;
}

/**
 * Build configuration for aggressive processing
 */
function buildAggressiveConfig(
  contentType: ContentType,
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  const isSpeech = contentType === 'speech' || contentType === 'podcast_mixed';
  const isMusic = contentType === 'music';

  const config: FilterConfig = {
    highpassFreq: isSpeech ? 100 : 40,
    noiseReductionStrength: isSpeech ? 10 : 5,
    applyNoiseReduction: problems.noiseFloor.detected,
    mudCutDb: problems.muddiness.detected ? -4 : 0,
    applyMudCut: problems.muddiness.detected,
    applyDeesser: isSpeech && problems.sibilance.detected,
    deesserIntensity: 0.6,
    applyCompression: false,
    compressionRatio: isSpeech ? 3 : 2,
    compressionThreshold: isSpeech ? -18 : -6,
    compressionAttack: isSpeech ? 15 : 50,
    compressionRelease: isSpeech ? 150 : 500,
    useDynaudnorm: false,
    dynaudnormFrameLen: 100, // Faster adaptation
    targetLufs: isSpeech ? -16 : -14,
    targetTruePeak: isSpeech ? -1.5 : -1,
    targetLra: 11,
  };

  // For speech: use dynaudnorm but with faster settings
  if (isSpeech) {
    config.useDynaudnorm = true;
  }

  // For music: apply compression if LRA > 15
  if (isMusic && metrics.loudnessRange > 15) {
    config.applyCompression = true;
    // Still keep it gentle per professional standards (max 2dB reduction)
    config.compressionRatio = 2;
    config.compressionThreshold = -10;
  }

  return config;
}

/**
 * Build content-optimized configuration
 */
function buildContentOptimizedConfig(
  contentType: ContentType,
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  switch (contentType) {
    case 'speech':
      return buildSpeechOptimizedConfig(problems, metrics);
    case 'music':
      return buildMusicOptimizedConfig(problems, metrics);
    case 'podcast_mixed':
      return buildPodcastMixedConfig(problems, metrics);
    default:
      // Unknown: use balanced approach
      return buildBalancedConfig(contentType, problems, metrics);
  }
}

/**
 * Speech-optimized configuration (podcast/voiceover/audiobook)
 */
function buildSpeechOptimizedConfig(
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  return {
    highpassFreq: 80,
    noiseReductionStrength: problems.noiseFloor.detected ? 7 : 0,
    applyNoiseReduction: problems.noiseFloor.detected,
    mudCutDb: problems.muddiness.detected ? -3 : 0,
    applyMudCut: problems.muddiness.detected,
    applyDeesser: problems.sibilance.detected,
    deesserIntensity: 0.4,
    applyCompression: false,
    compressionRatio: 1,
    compressionThreshold: 0,
    compressionAttack: 0,
    compressionRelease: 0,
    useDynaudnorm: true, // Always use dynaudnorm for speech
    dynaudnormFrameLen: 150,
    targetLufs: -16, // Podcast standard
    targetTruePeak: -1.5,
    targetLra: 11,
  };
}

/**
 * Music-optimized configuration (preserve dynamics)
 */
function buildMusicOptimizedConfig(
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  const needsCompression = metrics.loudnessRange > 20;

  return {
    highpassFreq: 30, // Preserve bass
    noiseReductionStrength: problems.noiseFloor.detected ? 2 : 0,
    applyNoiseReduction: problems.noiseFloor.detected && problems.noiseFloor.severity !== 'mild',
    mudCutDb: 0, // Don't cut mud in music by default
    applyMudCut: false,
    applyDeesser: false, // Never de-ess music
    deesserIntensity: 0,
    applyCompression: needsCompression,
    compressionRatio: 1.5, // Very gentle
    compressionThreshold: -6,
    compressionAttack: 50, // Slow attack preserves transients
    compressionRelease: 500, // Long release avoids pumping
    useDynaudnorm: false, // Never use dynaudnorm for music
    dynaudnormFrameLen: 0,
    targetLufs: -14, // Streaming standard
    targetTruePeak: -1,
    targetLra: 11, // Allow dynamic range
  };
}

/**
 * Podcast with music - mixed content config
 */
function buildPodcastMixedConfig(
  problems: AnalysisResult['problems'],
  metrics: any
): FilterConfig {
  return {
    highpassFreq: 60, // Compromise
    noiseReductionStrength: problems.noiseFloor.detected ? 5 : 0,
    applyNoiseReduction: problems.noiseFloor.detected,
    mudCutDb: problems.muddiness.detected ? -2 : 0,
    applyMudCut: problems.muddiness.detected,
    applyDeesser: problems.sibilance.detected,
    deesserIntensity: 0.3,
    applyCompression: false,
    compressionRatio: 1,
    compressionThreshold: 0,
    compressionAttack: 0,
    compressionRelease: 0,
    useDynaudnorm: true, // Use dynaudnorm but with gentler settings
    dynaudnormFrameLen: 200, // Slower adaptation for mixed content
    targetLufs: -16,
    targetTruePeak: -1.5,
    targetLra: 11,
  };
}

/**
 * Check if there are significant problems warranting aggressive processing
 */
function hasSignificantProblems(problems: AnalysisResult['problems']): boolean {
  return (
    problems.noiseFloor.severity === 'moderate' ||
    problems.noiseFloor.severity === 'severe' ||
    problems.sibilance.severity === 'moderate' ||
    problems.sibilance.severity === 'severe' ||
    problems.muddiness.severity === 'moderate' ||
    problems.muddiness.severity === 'severe' ||
    problems.excessiveDynamicRange.severity === 'moderate' ||
    problems.excessiveDynamicRange.severity === 'severe'
  );
}

/**
 * Build a processing candidate from configuration
 */
function buildCandidate(
  level: AggressivenessLevel | 'content-optimized',
  config: FilterConfig,
  contentType: ContentType
): ProcessingCandidate {
  const filters: string[] = [];
  const filtersApplied: string[] = [];

  // 1. High-pass filter (always first - cleanup)
  filters.push(`highpass=f=${config.highpassFreq}`);
  filtersApplied.push(`High-pass filter at ${config.highpassFreq}Hz`);

  // 2. Noise reduction (before compression)
  if (config.applyNoiseReduction && config.noiseReductionStrength > 0) {
    filters.push(`anlmdn=s=${config.noiseReductionStrength}`);
    filtersApplied.push(`Noise reduction (strength ${config.noiseReductionStrength})`);
  }

  // 3. Mud cut EQ (corrective, before compression)
  if (config.applyMudCut && config.mudCutDb !== 0) {
    filters.push(`equalizer=f=300:t=q:w=1:g=${config.mudCutDb}`);
    filtersApplied.push(`EQ: cut ${Math.abs(config.mudCutDb)}dB at 300Hz`);
  }

  // 4. De-esser (speech only, before compression)
  if (config.applyDeesser) {
    filters.push(`deesser=i=${config.deesserIntensity}:m=0.5:f=5500:s=o`);
    filtersApplied.push(`De-esser (intensity ${config.deesserIntensity})`);
  }

  // 5. Leveling: dynaudnorm OR compression (never both)
  if (config.useDynaudnorm) {
    filters.push(`dynaudnorm=f=${config.dynaudnormFrameLen}:g=15:p=0.95:m=10:b=1`);
    filtersApplied.push('Volume leveling (dynaudnorm)');
  } else if (config.applyCompression) {
    filters.push(
      `acompressor=threshold=${config.compressionThreshold}dB:ratio=${config.compressionRatio}:attack=${config.compressionAttack}:release=${config.compressionRelease}:knee=6`
    );
    filtersApplied.push(
      `Compression (${config.compressionRatio}:1, ${config.compressionThreshold}dB threshold)`
    );
  }

  // 6. Loudness normalization (always last, includes limiter)
  filters.push(
    `loudnorm=I=${config.targetLufs}:TP=${config.targetTruePeak}:LRA=${config.targetLra}:linear=true`
  );
  filtersApplied.push(`Loudness normalization to ${config.targetLufs} LUFS`);

  const filterChain = filters.join(',');

  // Generate candidate name and description
  const names: Record<string, string> = {
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
    'content-optimized': `${contentType.charAt(0).toUpperCase() + contentType.slice(1)}-Optimized`,
  };

  const descriptions: Record<string, string> = {
    conservative: 'Minimal processing: high-pass filter and loudness normalization only',
    balanced: 'Moderate processing: addresses detected issues with balanced settings',
    aggressive: 'Stronger processing: more aggressive correction for detected issues',
    'content-optimized': `Tailored processing optimized for ${contentType} content`,
  };

  return {
    id: `${level}-${contentType}`,
    name: names[level] || level,
    description: descriptions[level] || '',
    aggressiveness: level === 'content-optimized' ? 'balanced' : level,
    filterChain,
    filtersApplied,
    targetLufs: config.targetLufs,
    targetTruePeak: config.targetTruePeak,
  };
}

/**
 * Get the FFmpeg filter chain for a specific candidate
 */
export function getFilterChain(candidate: ProcessingCandidate): string {
  return candidate.filterChain;
}
