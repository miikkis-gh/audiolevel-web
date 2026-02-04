/**
 * Mastering Processor - Custom FFmpeg-based mastering pipeline
 * Based on auto_master_safe.sh
 * Target: -9 LUFS, -0.5 dBTP (safe headroom)
 */

import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';
import { runFFmpegCommand, runFFprobeCommand } from '../utils/ffmpeg';

export interface MasteringAnalysis {
  integratedLufs: number;
  lra: number;           // Loudness Range
  truePeak: number;      // dBTP
  rmsDb: number;         // RMS level
  peakDb: number;        // Peak level
  crestFactor: number;   // Peak - RMS (dynamics indicator)
}

export interface MasteringResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  inputAnalysis?: MasteringAnalysis;
  outputAnalysis?: MasteringAnalysis;
  filterChain?: string;
  decisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
}

export interface MasteringCallbacks {
  onProgress?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

export interface PreflightResult {
  passed: boolean;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  rejectReason?: string;
}

/**
 * Measured values from loudnorm first pass (used for linear mode in second pass)
 */
export interface LoudnormMeasured {
  input_i: number;      // measured integrated loudness
  input_tp: number;     // measured true peak
  input_lra: number;    // measured loudness range
  input_thresh: number; // measured threshold
  target_offset: number; // calculated offset
}

// Using shared runFFmpegCommand from utils/ffmpeg.ts

// Using shared runFFprobeCommand from utils/ffmpeg.ts

/**
 * Preflight check for input audio file
 */
export async function preflightCheck(inputPath: string): Promise<PreflightResult> {
  try {
    const { stdout, exitCode } = await runFFprobeCommand([
      '-v', 'error',
      '-show_entries', 'stream=sample_rate,channels,bits_per_sample',
      '-of', 'json',
      inputPath
    ]);

    if (exitCode !== 0) {
      return { passed: false, sampleRate: 0, channels: 0, bitDepth: 0, rejectReason: 'Failed to probe file' };
    }

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];

    const sampleRate = parseInt(stream?.sample_rate || '0', 10);
    const channels = parseInt(stream?.channels || '0', 10);
    const bitDepth = parseInt(stream?.bits_per_sample || '0', 10);

    if (sampleRate < 44100) {
      return { passed: false, sampleRate, channels, bitDepth, rejectReason: 'Sample rate must be at least 44.1kHz' };
    }

    if (channels > 2) {
      return { passed: false, sampleRate, channels, bitDepth, rejectReason: 'Only mono or stereo audio supported' };
    }

    return { passed: true, sampleRate, channels, bitDepth };
  } catch (e) {
    return { passed: false, sampleRate: 0, channels: 0, bitDepth: 0, rejectReason: 'Failed to parse probe output' };
  }
}

/**
 * Analyze audio loudness and dynamics using FFmpeg
 */
export async function analyzeLoudnessForMastering(inputPath: string): Promise<MasteringAnalysis | null> {
  const log = createChildLogger({ inputPath });

  try {
    const { stderr, exitCode } = await runFFmpegCommand([
      '-i', inputPath,
      '-af', 'ebur128=peak=true,astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-'
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode }, 'Loudness analysis failed');
      return null;
    }

    // Extract Summary section to avoid matching progress line placeholder values (-70 LUFS)
    const summaryMatch = stderr.match(/Summary:[\s\S]*$/);
    const summarySection = summaryMatch ? summaryMatch[0] : '';

    // Parse EBU R128 metrics from Summary section only
    const integratedMatch = summarySection.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lraMatch = summarySection.match(/LRA:\s*(-?[\d.]+)\s*LU/);
    const truePeakMatch = summarySection.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);

    // Parse astats metrics (from first channel or overall)
    const rmsMatch = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);

    const integratedLufs = integratedMatch ? parseFloat(integratedMatch[1]) : -23;
    const lra = lraMatch ? parseFloat(lraMatch[1]) : 6;
    const truePeak = truePeakMatch ? parseFloat(truePeakMatch[1]) : -1;
    const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : -20;
    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : -1;
    const crestFactor = Math.abs(peakDb - rmsDb);

    // Sanity check: if LUFS is still -70 or lower, parsing likely failed
    if (integratedLufs <= -60) {
      log.warn({
        integratedLufs,
        stderrTail: stderr.slice(-1000)
      }, 'LUFS parsing may have failed - value suspiciously low');
    }

    log.info({
      integratedLufs,
      lra,
      truePeak,
      rmsDb,
      peakDb,
      crestFactor
    }, 'Mastering analysis complete');

    return {
      integratedLufs,
      lra,
      truePeak,
      rmsDb,
      peakDb,
      crestFactor
    };
  } catch (err) {
    log.error({ err }, 'Loudness analysis error');
    return null;
  }
}

/**
 * Build the pre-loudnorm filter chain (highpass, optional compression, optional saturation)
 */
export function buildPreLoudnormChain(analysis: MasteringAnalysis): {
  filters: string[];
  compressionEnabled: boolean;
  saturationEnabled: boolean;
} {
  const filters: string[] = [];
  let compressionEnabled = false;
  let saturationEnabled = false;

  // Always start with high-pass cleanup
  filters.push('highpass=f=25');

  // Compression decision: enable if crest factor > 10 AND LRA > 5
  if (analysis.crestFactor > 10 && analysis.lra > 5) {
    compressionEnabled = true;
    filters.push('acompressor=threshold=-18dB:ratio=2.5:attack=30:release=200');
  }

  // Saturation decision: enable if LUFS < -12 AND true peak < -1.5
  if (analysis.integratedLufs < -12 && analysis.truePeak < -1.5) {
    saturationEnabled = true;
    filters.push('asoftclip=type=tanh');
  }

  return { filters, compressionEnabled, saturationEnabled };
}

/**
 * Build the first-pass filter chain for loudnorm measurement
 * Runs the pre-processing chain + loudnorm with print_format=json to get measured values
 */
export function buildFirstPassChain(preFilters: string[]): string {
  const filters = [...preFilters];
  // Loudnorm in measurement mode - outputs JSON with measured values
  filters.push('loudnorm=I=-9:TP=-1.0:LRA=5:print_format=json');
  return filters.join(',');
}

/**
 * Build the second-pass filter chain with linear loudnorm
 * Uses measured values from first pass to apply constant gain (no pumping)
 */
export function buildSecondPassChain(preFilters: string[], measured: LoudnormMeasured): string {
  const filters = [...preFilters];

  // Loudnorm in linear mode - applies constant gain based on measured values
  // This eliminates the pumping artifact caused by dynamic gain adjustment
  filters.push(
    `loudnorm=I=-9:TP=-1.0:LRA=5:` +
    `measured_I=${measured.input_i}:` +
    `measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:` +
    `measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}:` +
    `linear=true:print_format=summary`
  );

  // Aggressive true-peak limiter @ -0.6 dBTP (limit=0.93 ≈ -0.63 dB)
  // This ensures no inter-sample peaks exceed -0.5 dBTP
  filters.push('alimiter=limit=0.93:attack=0.5:release=20:level=false');

  return filters.join(',');
}

/**
 * Parse loudnorm JSON output to extract measured values
 */
export function parseLoudnormMeasured(stderr: string): LoudnormMeasured | null {
  try {
    // Find the JSON block in stderr (loudnorm outputs JSON between braces)
    const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*"target_offset"[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const data = JSON.parse(jsonMatch[0]);

    return {
      input_i: parseFloat(data.input_i),
      input_tp: parseFloat(data.input_tp),
      input_lra: parseFloat(data.input_lra),
      input_thresh: parseFloat(data.input_thresh),
      target_offset: parseFloat(data.target_offset),
    };
  } catch {
    return null;
  }
}

/**
 * Build the mastering filter chain based on analysis (legacy single-pass, kept for reference)
 * @deprecated Use two-pass processing with buildFirstPassChain/buildSecondPassChain instead
 */
export function buildMasteringFilterChain(analysis: MasteringAnalysis): {
  filterChain: string;
  compressionEnabled: boolean;
  saturationEnabled: boolean;
} {
  const { filters, compressionEnabled, saturationEnabled } = buildPreLoudnormChain(analysis);

  // Single-pass loudnorm (causes pumping - deprecated)
  filters.push('loudnorm=I=-9:TP=-1.0:LRA=5:print_format=summary');
  filters.push('alimiter=limit=0.93:attack=0.5:release=20:level=false');

  return {
    filterChain: filters.join(','),
    compressionEnabled,
    saturationEnabled
  };
}

/**
 * Get FFmpeg codec arguments for output format
 */
function getCodecArgs(format: string): string[] {
  switch (format.toLowerCase()) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', '320k'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'aac':
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', '192k'];
    case 'wav':
    default:
      return ['-c:a', 'pcm_s24le'];
  }
}

/**
 * Run the mastering process (two-pass for linear loudnorm, eliminates pumping)
 */
export async function runMasteringProcess(
  inputPath: string,
  outputPath: string,
  callbacks?: MasteringCallbacks,
  outputFormat?: string
): Promise<MasteringResult> {
  const log = createChildLogger({ inputPath, outputPath });
  const startTime = Date.now();

  try {
    // Stage 1: Analysis
    callbacks?.onStage?.('Analyzing audio dynamics...');
    callbacks?.onProgress?.(5);

    const inputAnalysis = await analyzeLoudnessForMastering(inputPath);
    if (!inputAnalysis) {
      return { success: false, error: 'Failed to analyze input audio' };
    }

    log.info({ inputAnalysis }, 'Input analysis complete');

    // Stage 2: Build pre-loudnorm chain
    callbacks?.onStage?.('Building mastering chain...');
    callbacks?.onProgress?.(10);

    const { filters: preFilters, compressionEnabled, saturationEnabled } = buildPreLoudnormChain(inputAnalysis);

    log.info({
      preFilters,
      compressionEnabled,
      saturationEnabled
    }, 'Pre-loudnorm chain built');

    // Stage 3: First pass - measure loudness through the processing chain
    callbacks?.onStage?.('Measuring loudness (pass 1)...');
    callbacks?.onProgress?.(15);

    const firstPassChain = buildFirstPassChain(preFilters);

    const { stderr: firstPassStderr, exitCode: firstPassExit } = await runFFmpegCommand([
      '-i', inputPath,
      '-af', firstPassChain,
      '-f', 'null',
      '-'
    ]);

    if (firstPassExit !== 0) {
      log.error({ exitCode: firstPassExit, stderr: firstPassStderr }, 'First pass failed');
      return { success: false, error: `Loudness measurement failed: ${firstPassStderr.slice(0, 500)}` };
    }

    // Parse measured values from first pass
    const measured = parseLoudnormMeasured(firstPassStderr);
    if (!measured) {
      log.error({ stderr: firstPassStderr.slice(-1000) }, 'Failed to parse loudnorm measurements');
      return { success: false, error: 'Failed to parse loudness measurements from first pass' };
    }

    log.info({ measured }, 'Loudnorm measurements extracted');

    callbacks?.onProgress?.(40);

    // Stage 4: Second pass - apply linear loudnorm with measured values
    callbacks?.onStage?.('Applying mastering (pass 2)...');
    callbacks?.onProgress?.(45);

    const secondPassChain = buildSecondPassChain(preFilters, measured);

    // Determine output format and get codec args
    const format = outputFormat || outputPath.split('.').pop()?.toLowerCase() || 'wav';
    const codecArgs = getCodecArgs(format);

    const { stderr: secondPassStderr, exitCode: secondPassExit } = await runFFmpegCommand([
      '-i', inputPath,
      '-af', secondPassChain,
      '-ar', '48000',           // Output at 48kHz
      ...codecArgs,             // Format-specific codec args
      '-y',
      outputPath
    ]);

    if (secondPassExit !== 0) {
      log.error({ exitCode: secondPassExit, stderr: secondPassStderr }, 'Second pass failed');
      return { success: false, error: `Mastering failed: ${secondPassStderr.slice(0, 500)}` };
    }

    callbacks?.onProgress?.(80);

    // Stage 5: Post-master QC
    callbacks?.onStage?.('Verifying output...');
    callbacks?.onProgress?.(90);

    const outputAnalysis = await analyzeLoudnessForMastering(outputPath);

    // QC checks
    if (outputAnalysis) {
      const lufsOk = outputAnalysis.integratedLufs >= -10.0 && outputAnalysis.integratedLufs <= -8.5;
      const tpOk = outputAnalysis.truePeak < -0.5;

      if (!lufsOk) {
        log.warn({ outputLufs: outputAnalysis.integratedLufs }, 'Output LUFS outside target range');
      }
      if (!tpOk) {
        log.warn({ outputTp: outputAnalysis.truePeak }, 'Output true peak exceeds limit');
      }
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({ duration, twoPass: true }, 'Mastering complete');

    return {
      success: true,
      outputPath,
      duration,
      inputAnalysis,
      outputAnalysis: outputAnalysis ?? undefined,
      filterChain: secondPassChain,
      decisions: {
        compressionEnabled,
        saturationEnabled
      }
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown mastering error';
    log.error({ err }, 'Mastering error');
    return { success: false, error: errorMessage };
  }
}
