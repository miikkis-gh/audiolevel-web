/**
 * Audio Quality Evaluator
 *
 * Evaluates processed candidates using loudness metrics and perceptual quality.
 * Picks the winner based on weighted scoring appropriate for content type.
 *
 * @module services/audioEvaluator
 */

import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { runCommand } from '../utils/ffmpeg';
import type { ContentType } from '../types/analysis';
import type { ProcessingCandidate } from '../types/candidate';
import type {
  CandidateMetrics,
  CandidateScore,
  EvaluationResult,
  EvaluationConfig,
  ScoringWeights,
  QualityMethod,
} from '../types/evaluation';
import type { CandidateProcessingResult } from './candidateExecutor';

const log = createChildLogger({ service: 'audioEvaluator' });

/**
 * Scoring weights by content type
 */
const WEIGHTS: Record<ContentType | 'unknown', ScoringWeights> = {
  speech: {
    loudnessAccuracy: 0.25,
    dynamicRange: 0.15,
    peakSafety: 0.10,
    noiseReduction: 0.25,
    perceptualQuality: 0.25,
  },
  music: {
    loudnessAccuracy: 0.20,
    dynamicRange: 0.30, // Preserve dynamics (important!)
    peakSafety: 0.10,
    noiseReduction: 0.10,
    perceptualQuality: 0.30, // Perceptual quality (important!)
  },
  podcast_mixed: {
    loudnessAccuracy: 0.25,
    dynamicRange: 0.20,
    peakSafety: 0.10,
    noiseReduction: 0.20,
    perceptualQuality: 0.25,
  },
  unknown: {
    loudnessAccuracy: 0.20,
    dynamicRange: 0.20,
    peakSafety: 0.15,
    noiseReduction: 0.20,
    perceptualQuality: 0.25,
  },
};

/**
 * Evaluate all candidates and pick the winner
 *
 * @param candidates - Processing candidates with their configurations
 * @param results - Processing results with output paths
 * @param originalPath - Path to original input file
 * @param contentType - Detected content type
 * @param config - Evaluation configuration
 * @returns Evaluation result with winner and scores
 */
export async function evaluateCandidates(
  candidates: ProcessingCandidate[],
  results: CandidateProcessingResult[],
  originalPath: string,
  contentType: ContentType,
  config: EvaluationConfig
): Promise<EvaluationResult> {
  log.info({ candidateCount: candidates.length, contentType }, 'Starting candidate evaluation');

  // Create a map of candidate configs by ID
  const candidateMap = new Map(candidates.map(c => [c.id, c]));

  // Evaluate each successful candidate
  const scores: CandidateScore[] = [];

  for (const result of results) {
    if (!result.success || !result.outputPath) {
      log.warn({ candidateId: result.candidateId }, 'Skipping failed candidate');
      continue;
    }

    const candidate = candidateMap.get(result.candidateId);
    if (!candidate) continue;

    const metrics = await measureMetrics(result.outputPath, originalPath);
    const score = scoreCandidate(candidate, metrics, contentType, config);
    scores.push(score);
  }

  if (scores.length === 0) {
    throw new Error('No candidates passed evaluation');
  }

  // Get quality method from first candidate (same for all)
  const qualityMethod = scores[0].metrics.qualityMethod;

  // Pick the winner
  const winner = pickWinner(scores, contentType, qualityMethod);

  log.info({
    winnerId: winner.winnerId,
    winnerName: winner.winnerName,
    winnerScore: winner.candidates.find(c => c.candidateId === winner.winnerId)?.totalScore,
  }, 'Winner selected');

  return winner;
}

/**
 * Measure metrics on a processed file
 */
async function measureMetrics(
  processedPath: string,
  originalPath: string
): Promise<CandidateMetrics> {
  // Get loudness metrics via loudnorm
  const loudnessMetrics = await getLoudnessMetrics(processedPath);

  // Estimate SNR improvement
  const snrEstimate = await estimateSnr(processedPath);

  // Get ViSQOL score (or estimate if not available)
  const qualityResult = await getVisqolScore(processedPath, originalPath);

  return {
    integratedLufs: loudnessMetrics.integratedLufs,
    loudnessRange: loudnessMetrics.loudnessRange,
    truePeak: loudnessMetrics.truePeak,
    visqolScore: qualityResult.score,
    snrEstimate,
    qualityMethod: qualityResult.method,
  };
}

/**
 * Get loudness metrics from a file
 */
async function getLoudnessMetrics(filePath: string): Promise<{
  integratedLufs: number;
  loudnessRange: number;
  truePeak: number;
}> {
  try {
    const { stderr } = await runCommand('ffmpeg', [
      '-i', filePath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        integratedLufs: parseFloat(data.input_i) || -23,
        loudnessRange: parseFloat(data.input_lra) || 6,
        truePeak: parseFloat(data.input_tp) || -1,
      };
    }
  } catch (err) {
    log.error({ err, filePath }, 'Failed to get loudness metrics');
  }

  return { integratedLufs: -23, loudnessRange: 6, truePeak: -1 };
}

/**
 * Estimate SNR from a file
 */
async function estimateSnr(filePath: string): Promise<number> {
  try {
    const { stderr } = await runCommand('ffmpeg', [
      '-i', filePath,
      '-af', 'astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    const rmsMatch = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);

    if (rmsMatch && peakMatch) {
      const rms = parseFloat(rmsMatch[1]);
      const peak = parseFloat(peakMatch[1]);
      // Rough SNR estimate: peak - RMS indicates dynamic range/noise floor
      return Math.abs(peak - rms);
    }
  } catch (err) {
    log.error({ err, filePath }, 'Failed to estimate SNR');
  }

  return 20; // Default estimate
}

// Track ViSQOL availability
let visqolAvailable: boolean | null = null;

/**
 * Check if ViSQOL is available on the system
 */
export async function checkVisqolAvailability(): Promise<boolean> {
  if (visqolAvailable !== null) {
    return visqolAvailable;
  }

  try {
    // ViSQOL uses abseil flags which return exit code 1 for --help
    // Check if binary runs and produces expected output instead
    const { exitCode, stdout, stderr } = await runCommand(env.VISQOL_PATH, ['--help'], { timeoutMs: 5000 });
    const output = stdout + stderr;
    // ViSQOL is available if it outputs its description (even with exit code 1)
    visqolAvailable = output.includes('Perceptual quality estimator');
    if (visqolAvailable) {
      log.info({ path: env.VISQOL_PATH }, 'ViSQOL is available');
    } else {
      log.warn({ exitCode, output: output.slice(0, 200) }, 'ViSQOL binary found but unexpected output');
      visqolAvailable = false;
    }
  } catch {
    log.info('ViSQOL not available - using FFmpeg spectral analysis fallback');
    visqolAvailable = false;
  }

  return visqolAvailable;
}

/**
 * Result of perceptual quality measurement
 */
interface QualityResult {
  score: number;
  method: QualityMethod;
}

/**
 * Get ViSQOL perceptual quality score
 *
 * ViSQOL compares processed vs original and returns MOS (1-5).
 * If ViSQOL is not available, falls back to spectral analysis.
 */
async function getVisqolScore(
  processedPath: string,
  originalPath: string
): Promise<QualityResult> {
  // Check availability (cached after first check)
  const hasVisqol = await checkVisqolAvailability();

  if (hasVisqol) {
    try {
      const { stdout, exitCode } = await runCommand(env.VISQOL_PATH, [
        '--reference_file', originalPath,
        '--degraded_file', processedPath,
        '--similarity_to_quality_model', env.VISQOL_MODEL_PATH,
      ], { timeoutMs: 60000 });

      if (exitCode === 0) {
        // Parse MOS score from output
        const mosMatch = stdout.match(/MOS-LQO:\s*([\d.]+)/);
        if (mosMatch) {
          const score = parseFloat(mosMatch[1]);
          log.debug({ processedPath, visqolScore: score }, 'ViSQOL score calculated');
          return { score, method: 'visqol' };
        }
      }
    } catch (err) {
      log.warn({ err }, 'ViSQOL execution failed, using fallback');
    }
  }

  // Fallback: spectral analysis-based quality estimate
  const score = await estimatePerceptualQuality(processedPath, originalPath);
  return { score, method: 'spectral_fallback' };
}

/**
 * Fallback perceptual quality estimate when ViSQOL is not available
 *
 * Uses spectral analysis to compare original vs processed:
 * - Spectral difference (artifacts/distortion)
 * - Dynamic range preservation
 * - High-frequency energy preservation
 * - Phase coherence estimation
 */
async function estimatePerceptualQuality(
  processedPath: string,
  originalPath: string
): Promise<number> {
  // Run parallel analysis of both files
  const [
    processedMetrics,
    originalMetrics,
    processedSpectral,
    originalSpectral,
  ] = await Promise.all([
    getLoudnessMetrics(processedPath),
    getLoudnessMetrics(originalPath),
    getSpectralMetrics(processedPath),
    getSpectralMetrics(originalPath),
  ]);

  // Start with a base score of 4.0 (good quality)
  let score = 4.0;
  const penalties: string[] = [];
  const bonuses: string[] = [];

  // 1. Dynamic range preservation (important for music)
  const lraDiff = originalMetrics.loudnessRange - processedMetrics.loudnessRange;
  if (lraDiff > 8) {
    // Severe compression
    score -= 0.6;
    penalties.push('severe_compression');
  } else if (lraDiff > 5) {
    // Moderate compression
    score -= 0.3;
    penalties.push('moderate_compression');
  } else if (lraDiff < 2) {
    // Good preservation
    score += 0.1;
    bonuses.push('dynamics_preserved');
  }

  // 2. True peak handling
  if (processedMetrics.truePeak > -0.3) {
    // Potential inter-sample clipping
    score -= 0.5;
    penalties.push('potential_clipping');
  } else if (processedMetrics.truePeak > -0.8) {
    // Borderline safe
    score -= 0.2;
    penalties.push('marginal_headroom');
  }

  // 3. Spectral centroid preservation (tonal balance)
  const centroidDiff = Math.abs(processedSpectral.centroid - originalSpectral.centroid) / originalSpectral.centroid;
  if (centroidDiff > 0.3) {
    // Significant tonal shift
    score -= 0.4;
    penalties.push('tonal_shift');
  } else if (centroidDiff > 0.15) {
    // Minor tonal shift
    score -= 0.15;
    penalties.push('minor_tonal_shift');
  }

  // 4. High frequency energy preservation (detail/air)
  const hfRatio = originalSpectral.highEnergy > 0 ?
    processedSpectral.highEnergy / originalSpectral.highEnergy : 1;
  if (hfRatio < 0.5) {
    // Lost high frequencies (dull sound)
    score -= 0.35;
    penalties.push('hf_loss');
  } else if (hfRatio > 1.5) {
    // Boosted highs (harsh sound)
    score -= 0.25;
    penalties.push('hf_boost');
  }

  // 5. Spectral flatness change (artifacts/distortion indicator)
  const flatnessDiff = Math.abs(processedSpectral.flatness - originalSpectral.flatness);
  if (flatnessDiff > 0.2) {
    // Significant spectral change (possible artifacts)
    score -= 0.3;
    penalties.push('spectral_artifacts');
  }

  // 6. RMS level consistency (no pumping)
  const rmsVariance = Math.abs(processedSpectral.rmsVariance - originalSpectral.rmsVariance);
  if (rmsVariance > 5) {
    // Introduced pumping/breathing
    score -= 0.25;
    penalties.push('pumping');
  }

  // Clamp to valid MOS range (1-5)
  score = Math.max(1, Math.min(5, score));

  log.info({
    processedPath: processedPath.split('/').pop(), // Just filename
    estimatedMos: score.toFixed(2),
    penalties,
    bonuses,
  }, 'Perceptual quality estimated via spectral analysis');

  return score;
}

/**
 * Get spectral metrics for quality estimation
 */
async function getSpectralMetrics(filePath: string): Promise<{
  centroid: number;
  flatness: number;
  highEnergy: number;
  rmsVariance: number;
}> {
  try {
    // Use aspectralstats for spectral analysis
    const { stderr: spectralOut } = await runCommand('ffmpeg', [
      '-i', filePath,
      '-af', 'aspectralstats=measure=mean',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    // Use astats for RMS analysis
    const { stderr: statsOut } = await runCommand('ffmpeg', [
      '-i', filePath,
      '-af', 'astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    const centroidMatch = spectralOut.match(/spectral_centroid:\s*([\d.]+)/);
    const flatnessMatch = spectralOut.match(/spectral_flatness:\s*([\d.]+)/);

    // Estimate high frequency energy from spectral centroid
    const centroid = centroidMatch ? parseFloat(centroidMatch[1]) : 2000;
    const flatness = flatnessMatch ? parseFloat(flatnessMatch[1]) : 0.5;

    // Extract RMS variance from astats
    const rmsMatch = statsOut.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = statsOut.match(/Peak level dB:\s*(-?[\d.]+)/);

    const rms = rmsMatch ? parseFloat(rmsMatch[1]) : -20;
    const peak = peakMatch ? parseFloat(peakMatch[1]) : -1;
    const rmsVariance = Math.abs(peak - rms);

    // High energy estimate based on centroid position
    const highEnergy = Math.min(1, centroid / 8000);

    return { centroid, flatness, highEnergy, rmsVariance };
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to get spectral metrics');
    return { centroid: 2000, flatness: 0.5, highEnergy: 0.25, rmsVariance: 15 };
  }
}

/**
 * Score a single candidate
 */
function scoreCandidate(
  candidate: ProcessingCandidate,
  metrics: CandidateMetrics,
  contentType: ContentType,
  config: EvaluationConfig
): CandidateScore {
  const weights = WEIGHTS[contentType] || WEIGHTS.unknown;

  // Calculate individual scores (0-100)

  // Loudness accuracy: how close to target LUFS
  const lufsError = Math.abs(metrics.integratedLufs - config.targetLufs);
  const loudnessAccuracy = Math.max(0, 100 - (lufsError * 10));

  // Dynamic range: within acceptable range
  const [minLra, maxLra] = config.acceptableLraRange;
  let dynamicRange: number;
  if (metrics.loudnessRange >= minLra && metrics.loudnessRange <= maxLra) {
    dynamicRange = 100;
  } else if (metrics.loudnessRange < minLra) {
    dynamicRange = Math.max(0, 100 - ((minLra - metrics.loudnessRange) * 10));
  } else {
    // For music, don't penalize high LRA too much
    const penalty = contentType === 'music' ? 5 : 10;
    dynamicRange = Math.max(0, 100 - ((metrics.loudnessRange - maxLra) * penalty));
  }

  // Peak safety: true peak below threshold
  const peakSafety = metrics.truePeak <= config.maximumTruePeak ? 100 :
    Math.max(0, 100 - ((metrics.truePeak - config.maximumTruePeak) * 50));

  // Noise reduction: SNR improvement
  const snrImprovement = metrics.snrEstimate - config.inputSnrEstimate;
  const noiseReduction = Math.min(100, 50 + (snrImprovement * 5));

  // Perceptual quality: ViSQOL score scaled to 0-100
  const perceptualQuality = ((metrics.visqolScore - 1) / 4) * 100;

  // Calculate weighted total
  const totalScore =
    (loudnessAccuracy * weights.loudnessAccuracy) +
    (dynamicRange * weights.dynamicRange) +
    (peakSafety * weights.peakSafety) +
    (noiseReduction * weights.noiseReduction) +
    (perceptualQuality * weights.perceptualQuality);

  // Safety checks
  let passedSafety = true;
  let rejectionReason: string | undefined;

  if (metrics.truePeak > -0.5) {
    passedSafety = false;
    rejectionReason = `True peak too high: ${metrics.truePeak.toFixed(1)} dBTP`;
  } else if (metrics.visqolScore < config.minimumVisqol) {
    passedSafety = false;
    rejectionReason = `Perceptual quality too low: ${metrics.visqolScore.toFixed(2)} MOS`;
  }

  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    scores: {
      loudnessAccuracy,
      dynamicRange,
      peakSafety,
      noiseReduction,
      perceptualQuality,
    },
    totalScore,
    metrics,
    passedSafety,
    rejectionReason,
  };
}

/**
 * Pick the winning candidate
 */
function pickWinner(scores: CandidateScore[], contentType: ContentType, qualityMethod: QualityMethod): EvaluationResult {
  // Filter to candidates that passed safety
  const safe = scores.filter(s => s.passedSafety);

  // If none passed, fall back to conservative
  if (safe.length === 0) {
    const conservative = scores.find(s => s.candidateName === 'Conservative');
    if (conservative) {
      return {
        winnerId: conservative.candidateId,
        winnerName: conservative.candidateName,
        winnerReason: 'Fallback to conservative processing (other candidates failed safety checks)',
        candidates: scores,
        contentType,
        qualityMethod,
      };
    }
    // Last resort: pick highest score regardless of safety
    const best = scores.sort((a, b) => b.totalScore - a.totalScore)[0];
    return {
      winnerId: best.candidateId,
      winnerName: best.candidateName,
      winnerReason: 'Best available option (no candidates fully passed safety)',
      candidates: scores,
      contentType,
      qualityMethod,
    };
  }

  // Sort by total score
  const sorted = safe.sort((a, b) => b.totalScore - a.totalScore);

  // Check for tie (within 5%)
  if (sorted.length >= 2) {
    const diff = (sorted[0].totalScore - sorted[1].totalScore) / sorted[0].totalScore;
    if (diff < 0.05) {
      // Prefer conservative on ties ("less is more")
      const conservative = sorted.find(s => s.candidateName === 'Conservative');
      if (conservative) {
        return {
          winnerId: conservative.candidateId,
          winnerName: conservative.candidateName,
          winnerReason: 'Conservative processing preferred (scores within 5%)',
          candidates: scores,
          contentType,
          qualityMethod,
        };
      }
    }
  }

  // Winner is highest scoring
  const winner = sorted[0];

  // Generate reason
  const reasons: string[] = [];
  if (winner.scores.perceptualQuality > 80) {
    reasons.push('excellent perceptual quality');
  }
  if (winner.scores.loudnessAccuracy > 90) {
    reasons.push('accurate loudness');
  }
  if (winner.scores.dynamicRange > 85) {
    reasons.push('good dynamic range');
  }
  if (winner.scores.noiseReduction > 70) {
    reasons.push('effective noise reduction');
  }

  const reasonText = reasons.length > 0 ?
    `Best overall score with ${reasons.join(', ')}` :
    `Highest overall score (${winner.totalScore.toFixed(1)})`;

  return {
    winnerId: winner.candidateId,
    winnerName: winner.candidateName,
    winnerReason: reasonText,
    candidates: scores,
    contentType,
    qualityMethod,
  };
}

/**
 * Create default evaluation config based on content type
 */
export function createEvaluationConfig(
  contentType: ContentType,
  inputSnrEstimate: number = 20
): EvaluationConfig {
  const isSpeech = contentType === 'speech' || contentType === 'podcast_mixed';

  return {
    targetLufs: isSpeech ? -16 : -14,
    targetTruePeak: isSpeech ? -1.5 : -1,
    acceptableLraRange: isSpeech ? [6, 15] : [8, 20],
    minimumVisqol: 3.0,
    maximumTruePeak: -0.5,
    inputSnrEstimate,
  };
}
