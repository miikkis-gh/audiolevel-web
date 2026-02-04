/**
 * Intelligent Audio Analyzer
 *
 * Analyzes audio files to detect content type (speech/music/mixed) and
 * identify problems (noise, clipping, sibilance, etc.) using FFmpeg and SoX.
 *
 * @module services/audioAnalyzer
 */

import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { runCommand } from '../utils/ffmpeg';
import type {
  AnalysisResult,
  AnalysisMetrics,
  AudioProblems,
  ContentClassification,
  ContentType,
  ContentSignal,
  Severity,
  AnalysisThresholds,
} from '../types/analysis';

const log = createChildLogger({ service: 'audioAnalyzer' });

/**
 * Default thresholds for problem detection
 */
export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  noise: {
    mild: -50, // dB - quiet segment RMS above this is mildly noisy
    moderate: -45,
    severe: -40,
  },
  clipping: {
    peakCount: 100,
    flatFactor: 0,
  },
  dcOffset: 0.01,
  lowLoudness: -24, // LUFS
  dynamicRange: {
    speech: 15, // LRA threshold for speech
    music: 20, // LRA threshold for music
  },
  sibilance: 6, // dB above neighbors in 5-8kHz
  muddiness: 4, // dB above reference in 200-500Hz
  stereoImbalance: 3, // dB
  silencePadding: 0.5, // seconds
};

/**
 * Analyze an audio file comprehensively
 *
 * @param inputPath - Path to the audio file
 * @param thresholds - Optional custom thresholds
 * @returns Complete analysis result
 */
export async function analyzeAudio(
  inputPath: string,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS
): Promise<AnalysisResult> {
  const analysisLog = createChildLogger({ inputPath });
  analysisLog.info('Starting comprehensive audio analysis');

  // Run all analysis steps in parallel where possible
  const [
    basicMetadata,
    loudnessMetrics,
    statsMetrics,
    silenceMetrics,
    spectralMetrics,
    soxMetrics,
  ] = await Promise.all([
    getBasicMetadata(inputPath),
    getLoudnessMetrics(inputPath),
    getAstatsMetrics(inputPath),
    getSilenceMetrics(inputPath),
    getSpectralMetrics(inputPath),
    getSoxMetrics(inputPath),
  ]);

  // Combine all metrics
  const metrics: AnalysisMetrics = {
    // Basic
    channels: basicMetadata.channels,
    sampleRate: basicMetadata.sampleRate,
    bitDepth: basicMetadata.bitDepth,
    duration: basicMetadata.duration,

    // Loudness
    integratedLufs: loudnessMetrics.integratedLufs,
    loudnessRange: loudnessMetrics.loudnessRange,
    truePeak: loudnessMetrics.truePeak,

    // Dynamics from astats
    rmsDb: statsMetrics.rmsDb,
    peakDb: statsMetrics.peakDb,
    crestFactor: Math.abs(statsMetrics.peakDb - statsMetrics.rmsDb),
    flatFactor: statsMetrics.flatFactor,
    peakCount: statsMetrics.peakCount,

    // Silence
    silenceRatio: silenceMetrics.silenceRatio,
    leadingSilence: silenceMetrics.leadingSilence,
    trailingSilence: silenceMetrics.trailingSilence,

    // Spectral
    spectralCentroid: spectralMetrics.centroid,
    spectralFlatness: spectralMetrics.flatness,
    lowFreqEnergy: spectralMetrics.lowEnergy,
    midFreqEnergy: spectralMetrics.midEnergy,
    highFreqEnergy: spectralMetrics.highEnergy,
    veryHighFreqEnergy: spectralMetrics.veryHighEnergy,

    // SoX specific
    dcOffset: soxMetrics.dcOffset,
    stereoBalance: soxMetrics.stereoBalance,
  };

  // Classify content type
  const contentType = classifyContent(metrics);

  // Detect problems
  const problems = detectProblems(metrics, contentType.type, thresholds);

  // Generate human-readable descriptions
  const problemDescriptions = generateProblemDescriptions(problems, metrics);

  const result: AnalysisResult = {
    contentType,
    problems,
    metrics,
    problemDescriptions,
  };

  analysisLog.info({ contentType: contentType.type, problemCount: problemDescriptions.length }, 'Analysis complete');
  return result;
}

/**
 * Get basic metadata via FFprobe
 */
async function getBasicMetadata(inputPath: string): Promise<{
  channels: number;
  sampleRate: number;
  bitDepth: number;
  duration: number;
}> {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=channels,sample_rate,bits_per_sample:format=duration',
      '-of', 'json',
      inputPath,
    ]);

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] || {};
    const format = data.format || {};

    return {
      channels: parseInt(stream.channels || '2', 10),
      sampleRate: parseInt(stream.sample_rate || '44100', 10),
      bitDepth: parseInt(stream.bits_per_sample || '16', 10),
      duration: parseFloat(format.duration || '0'),
    };
  } catch (err) {
    log.error({ err }, 'Failed to get basic metadata');
    return { channels: 2, sampleRate: 44100, bitDepth: 16, duration: 0 };
  }
}

/**
 * Get loudness metrics via FFmpeg loudnorm filter (first pass)
 */
async function getLoudnessMetrics(inputPath: string): Promise<{
  integratedLufs: number;
  loudnessRange: number;
  truePeak: number;
}> {
  try {
    const { stderr } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    // Extract JSON from output
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
    log.error({ err }, 'Failed to get loudness metrics');
  }

  return { integratedLufs: -23, loudnessRange: 6, truePeak: -1 };
}

/**
 * Get audio statistics via FFmpeg astats filter
 */
async function getAstatsMetrics(inputPath: string): Promise<{
  rmsDb: number;
  peakDb: number;
  flatFactor: number;
  peakCount: number;
}> {
  try {
    const { stderr } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    const rmsMatch = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);
    const flatMatch = stderr.match(/Flat factor:\s*([\d.]+)/);
    const peakCountMatch = stderr.match(/Peak count:\s*(\d+)/);

    return {
      rmsDb: rmsMatch ? parseFloat(rmsMatch[1]) : -20,
      peakDb: peakMatch ? parseFloat(peakMatch[1]) : -1,
      flatFactor: flatMatch ? parseFloat(flatMatch[1]) : 0,
      peakCount: peakCountMatch ? parseInt(peakCountMatch[1], 10) : 0,
    };
  } catch (err) {
    log.error({ err }, 'Failed to get astats metrics');
    return { rmsDb: -20, peakDb: -1, flatFactor: 0, peakCount: 0 };
  }
}

/**
 * Get silence metrics via FFmpeg silencedetect filter
 */
async function getSilenceMetrics(inputPath: string): Promise<{
  silenceRatio: number;
  leadingSilence: number;
  trailingSilence: number;
}> {
  try {
    // First get duration
    const { stdout: probeOut } = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      inputPath,
    ]);
    const duration = parseFloat(JSON.parse(probeOut).format?.duration || '0');

    // Then detect silence
    const { stderr } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'silencedetect=noise=-50dB:d=0.3',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    // Parse silence segments
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

    const startMatches = stderr.matchAll(/silence_start:\s*([\d.]+)/g);
    const endMatches = stderr.matchAll(/silence_end:\s*([\d.]+)/g);

    for (const match of startMatches) {
      silenceStarts.push(parseFloat(match[1]));
    }
    for (const match of endMatches) {
      silenceEnds.push(parseFloat(match[1]));
    }

    // Calculate total silence
    let totalSilence = 0;
    for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
      totalSilence += silenceEnds[i] - silenceStarts[i];
    }

    // Leading silence: if first silence starts at 0
    const leadingSilence = silenceStarts[0] === 0 ? (silenceEnds[0] || 0) : 0;

    // Trailing silence: estimate from last silence
    let trailingSilence = 0;
    if (silenceStarts.length > 0) {
      const lastStart = silenceStarts[silenceStarts.length - 1];
      const lastEnd = silenceEnds[silenceEnds.length - 1] || duration;
      if (lastEnd >= duration - 0.1) {
        trailingSilence = lastEnd - lastStart;
      }
    }

    return {
      silenceRatio: duration > 0 ? totalSilence / duration : 0,
      leadingSilence,
      trailingSilence,
    };
  } catch (err) {
    log.error({ err }, 'Failed to get silence metrics');
    return { silenceRatio: 0, leadingSilence: 0, trailingSilence: 0 };
  }
}

/**
 * Get spectral metrics via FFmpeg aspectralstats filter
 */
async function getSpectralMetrics(inputPath: string): Promise<{
  centroid: number;
  flatness: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  veryHighEnergy: number;
}> {
  try {
    const { stderr } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'aspectralstats=measure=mean',
      '-f', 'null',
      '-',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    // Parse spectral stats
    const centroidMatch = stderr.match(/spectral_centroid:\s*([\d.]+)/);
    const flatnessMatch = stderr.match(/spectral_flatness:\s*([\d.]+)/);

    // For frequency band energy, we need to use bandpass filters
    // This is a simplified approximation based on available data
    const centroid = centroidMatch ? parseFloat(centroidMatch[1]) : 2000;
    const flatness = flatnessMatch ? parseFloat(flatnessMatch[1]) : 0.5;

    // Estimate frequency distribution based on centroid
    // Lower centroid = more low frequency content
    const normalizedCentroid = Math.min(centroid / 8000, 1);

    return {
      centroid,
      flatness,
      lowEnergy: 1 - normalizedCentroid,
      midEnergy: 0.5, // Default middle range
      highEnergy: normalizedCentroid * 0.5,
      veryHighEnergy: normalizedCentroid * 0.3,
    };
  } catch (err) {
    log.error({ err }, 'Failed to get spectral metrics');
    return {
      centroid: 2000,
      flatness: 0.5,
      lowEnergy: 0.5,
      midEnergy: 0.5,
      highEnergy: 0.3,
      veryHighEnergy: 0.2,
    };
  }
}

/**
 * Get metrics from SoX (DC offset, stereo balance)
 */
async function getSoxMetrics(inputPath: string): Promise<{
  dcOffset: number;
  stereoBalance: number;
}> {
  try {
    const { stderr } = await runCommand('sox', [
      inputPath,
      '-n', 'stats',
    ], { timeoutMs: env.PROCESSING_TIMEOUT_MS });

    // Parse DC offset
    const dcMatch = stderr.match(/DC offset\s*(-?[\d.]+)/);
    const dcOffset = dcMatch ? Math.abs(parseFloat(dcMatch[1])) : 0;

    // Parse channel RMS for stereo balance
    const rmsMatches = [...stderr.matchAll(/RMS lev dB\s*(-?[\d.]+)/g)];
    let stereoBalance = 0;
    if (rmsMatches.length >= 2) {
      const leftRms = parseFloat(rmsMatches[0][1]);
      const rightRms = parseFloat(rmsMatches[1][1]);
      stereoBalance = leftRms - rightRms;
    }

    return { dcOffset, stereoBalance };
  } catch (err) {
    // SoX may not be available - fall back to defaults
    log.warn({ err }, 'SoX not available or failed, using defaults');
    return { dcOffset: 0, stereoBalance: 0 };
  }
}

/**
 * Classify content type based on metrics
 */
function classifyContent(metrics: AnalysisMetrics): ContentClassification {
  const signals: ContentSignal[] = [];
  let speechScore = 0;
  let musicScore = 0;

  // Silence ratio: high = speech (pauses between phrases)
  if (metrics.silenceRatio > 0.15) {
    speechScore += 0.3;
    signals.push({
      name: 'High silence ratio',
      value: metrics.silenceRatio,
      indicates: 'speech',
      weight: 0.3,
    });
  } else if (metrics.silenceRatio < 0.05) {
    musicScore += 0.3;
    signals.push({
      name: 'Low silence ratio',
      value: metrics.silenceRatio,
      indicates: 'music',
      weight: 0.3,
    });
  }

  // Crest factor: high = music (more dynamic), low = compressed speech
  if (metrics.crestFactor > 15) {
    musicScore += 0.2;
    signals.push({
      name: 'High crest factor',
      value: metrics.crestFactor,
      indicates: 'music',
      weight: 0.2,
    });
  } else if (metrics.crestFactor < 10) {
    speechScore += 0.1;
    signals.push({
      name: 'Low crest factor',
      value: metrics.crestFactor,
      indicates: 'speech',
      weight: 0.1,
    });
  }

  // Spectral flatness: high = noise-like (speech), low = tonal (music)
  if (metrics.spectralFlatness > 0.5) {
    speechScore += 0.2;
    signals.push({
      name: 'High spectral flatness',
      value: metrics.spectralFlatness,
      indicates: 'speech',
      weight: 0.2,
    });
  } else if (metrics.spectralFlatness < 0.3) {
    musicScore += 0.3;
    signals.push({
      name: 'Low spectral flatness',
      value: metrics.spectralFlatness,
      indicates: 'music',
      weight: 0.3,
    });
  }

  // Loudness range (LRA): high = dynamic content
  if (metrics.loudnessRange > 15) {
    musicScore += 0.2;
    signals.push({
      name: 'Wide loudness range',
      value: metrics.loudnessRange,
      indicates: 'music',
      weight: 0.2,
    });
  } else if (metrics.loudnessRange < 8) {
    speechScore += 0.2;
    signals.push({
      name: 'Narrow loudness range',
      value: metrics.loudnessRange,
      indicates: 'speech',
      weight: 0.2,
    });
  }

  // Spectral centroid: voice range vs wider
  if (metrics.spectralCentroid < 2500 && metrics.spectralCentroid > 500) {
    speechScore += 0.2;
    signals.push({
      name: 'Voice-range spectral centroid',
      value: metrics.spectralCentroid,
      indicates: 'speech',
      weight: 0.2,
    });
  } else if (metrics.spectralCentroid > 3000) {
    musicScore += 0.1;
    signals.push({
      name: 'High spectral centroid',
      value: metrics.spectralCentroid,
      indicates: 'music',
      weight: 0.1,
    });
  }

  // Determine type
  let type: ContentType;
  let confidence: number;

  if (speechScore > 0.6 && speechScore > musicScore + 0.2) {
    type = 'speech';
    confidence = Math.min(speechScore, 1);
  } else if (musicScore > 0.6 && musicScore > speechScore + 0.2) {
    type = 'music';
    confidence = Math.min(musicScore, 1);
  } else if (speechScore > 0.3 && musicScore > 0.3) {
    type = 'podcast_mixed';
    confidence = 0.6;
  } else {
    type = 'unknown';
    confidence = 0.5;
  }

  return { type, confidence, signals };
}

/**
 * Detect problems based on metrics and content type
 */
function detectProblems(
  metrics: AnalysisMetrics,
  contentType: ContentType,
  thresholds: AnalysisThresholds
): AudioProblems {
  // Clipping
  const clippingDetected = metrics.flatFactor > thresholds.clipping.flatFactor ||
    metrics.peakCount > thresholds.clipping.peakCount;
  const clippingSeverity: Severity = !clippingDetected ? 'none' :
    metrics.peakCount > 1000 || metrics.flatFactor > 0.1 ? 'severe' :
    metrics.peakCount > 500 ? 'moderate' : 'mild';

  // Noise floor (estimate from RMS in quiet sections)
  const noiseEstimate = metrics.rmsDb + metrics.crestFactor; // Rough estimate
  const noiseDetected = noiseEstimate > thresholds.noise.mild;
  const noiseSeverity: Severity = !noiseDetected ? 'none' :
    noiseEstimate > thresholds.noise.severe ? 'severe' :
    noiseEstimate > thresholds.noise.moderate ? 'moderate' : 'mild';

  // DC offset
  const dcDetected = metrics.dcOffset > thresholds.dcOffset;

  // Low loudness
  const lowLoudnessDetected = metrics.integratedLufs < thresholds.lowLoudness;

  // Excessive dynamic range
  const lraThreshold = contentType === 'speech' ?
    thresholds.dynamicRange.speech : thresholds.dynamicRange.music;
  const excessiveLraDetected = metrics.loudnessRange > lraThreshold;
  const lraSeverity: Severity = !excessiveLraDetected ? 'none' :
    metrics.loudnessRange > lraThreshold + 10 ? 'severe' :
    metrics.loudnessRange > lraThreshold + 5 ? 'moderate' : 'mild';

  // Sibilance (based on high frequency energy)
  const sibilanceRatio = metrics.veryHighFreqEnergy / metrics.midFreqEnergy;
  const sibilanceDetected = sibilanceRatio > 0.5 && contentType !== 'music';
  const sibilanceSeverity: Severity = !sibilanceDetected ? 'none' :
    sibilanceRatio > 0.8 ? 'severe' : sibilanceRatio > 0.65 ? 'moderate' : 'mild';

  // Muddiness (excess low-mid energy)
  const muddinessRatio = metrics.lowFreqEnergy / metrics.midFreqEnergy;
  const muddinessDetected = muddinessRatio > 1.5;
  const muddinessSeverity: Severity = !muddinessDetected ? 'none' :
    muddinessRatio > 2.5 ? 'severe' : muddinessRatio > 2 ? 'moderate' : 'mild';

  // Stereo imbalance
  const stereoImbalanceDetected = Math.abs(metrics.stereoBalance) > thresholds.stereoImbalance;

  // Silence padding
  const silencePaddingDetected =
    metrics.leadingSilence > thresholds.silencePadding ||
    metrics.trailingSilence > thresholds.silencePadding;

  return {
    clipping: {
      detected: clippingDetected,
      severity: clippingSeverity,
      peakCount: metrics.peakCount,
      flatFactor: metrics.flatFactor,
    },
    noiseFloor: {
      detected: noiseDetected,
      severity: noiseSeverity,
      levelDb: noiseEstimate,
    },
    dcOffset: {
      detected: dcDetected,
      value: metrics.dcOffset,
    },
    lowLoudness: {
      detected: lowLoudnessDetected,
      integratedLufs: metrics.integratedLufs,
    },
    excessiveDynamicRange: {
      detected: excessiveLraDetected,
      severity: lraSeverity,
      lra: metrics.loudnessRange,
    },
    sibilance: {
      detected: sibilanceDetected,
      severity: sibilanceSeverity,
      energyRatio: sibilanceRatio,
    },
    muddiness: {
      detected: muddinessDetected,
      severity: muddinessSeverity,
      energyRatio: muddinessRatio,
    },
    stereoImbalance: {
      detected: stereoImbalanceDetected,
      differenceDb: metrics.stereoBalance,
    },
    silencePadding: {
      detected: silencePaddingDetected,
      startSeconds: metrics.leadingSilence,
      endSeconds: metrics.trailingSilence,
    },
  };
}

/**
 * Generate human-readable problem descriptions
 */
function generateProblemDescriptions(
  problems: AudioProblems,
  metrics: AnalysisMetrics
): { problem: string; details: string }[] {
  const descriptions: { problem: string; details: string }[] = [];

  if (problems.clipping.detected) {
    descriptions.push({
      problem: 'Clipping detected',
      details: `${problems.clipping.severity} clipping with ${problems.clipping.peakCount} peak samples — this cannot be fully repaired`,
    });
  }

  if (problems.noiseFloor.detected) {
    descriptions.push({
      problem: 'Elevated noise floor',
      details: `${problems.noiseFloor.severity} noise level estimated at ${problems.noiseFloor.levelDb.toFixed(1)} dB`,
    });
  }

  if (problems.dcOffset.detected) {
    descriptions.push({
      problem: 'DC offset present',
      details: `DC offset of ${problems.dcOffset.value.toFixed(4)} detected`,
    });
  }

  if (problems.lowLoudness.detected) {
    descriptions.push({
      problem: 'Low loudness',
      details: `Integrated loudness is ${metrics.integratedLufs.toFixed(1)} LUFS (very quiet)`,
    });
  }

  if (problems.excessiveDynamicRange.detected) {
    descriptions.push({
      problem: 'Wide dynamic range',
      details: `Loudness range of ${metrics.loudnessRange.toFixed(1)} LU (${problems.excessiveDynamicRange.severity})`,
    });
  }

  if (problems.sibilance.detected) {
    descriptions.push({
      problem: 'Sibilance detected',
      details: `${problems.sibilance.severity} harsh high frequencies in speech`,
    });
  }

  if (problems.muddiness.detected) {
    descriptions.push({
      problem: 'Muddiness detected',
      details: `${problems.muddiness.severity} excess low-mid frequency energy`,
    });
  }

  if (problems.stereoImbalance.detected) {
    descriptions.push({
      problem: 'Stereo imbalance',
      details: `${Math.abs(problems.stereoImbalance.differenceDb).toFixed(1)} dB difference between channels`,
    });
  }

  if (problems.silencePadding.detected) {
    const parts: string[] = [];
    if (problems.silencePadding.startSeconds > 0.5) {
      parts.push(`${problems.silencePadding.startSeconds.toFixed(1)}s at start`);
    }
    if (problems.silencePadding.endSeconds > 0.5) {
      parts.push(`${problems.silencePadding.endSeconds.toFixed(1)}s at end`);
    }
    descriptions.push({
      problem: 'Silence padding',
      details: `Excessive silence: ${parts.join(', ')}`,
    });
  }

  return descriptions;
}
