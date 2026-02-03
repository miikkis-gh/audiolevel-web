/**
 * Normalization Processor - Simple loudness normalization for speech/podcast content
 * Applies: 25Hz highpass filter + EBU R128 loudness normalization to target LUFS
 * Used for: Podcasts, Audiobooks, Voiceover, etc.
 */

import { spawn } from 'bun';
import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';
import type { AudioProfile } from './profileDetector';

export interface NormalizationAnalysis {
  integratedLufs: number;
  truePeak: number;
  loudnessRange: number;
}

export interface NormalizationResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  inputAnalysis?: NormalizationAnalysis;
  outputAnalysis?: NormalizationAnalysis;
  filterChain?: string;
  targetLufs?: number;
}

export interface NormalizationCallbacks {
  onProgress?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

/**
 * Run FFmpeg command and capture output
 */
async function runFFmpeg(
  args: string[],
  timeoutMs: number = env.PROCESSING_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn({
      cmd: ['ffmpeg', ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill();
      reject(new Error('FFmpeg timeout exceeded'));
    }, timeoutMs);

    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value);
        }
      } catch {
        // Ignore read errors on killed process
      }
    })();

    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value);
        }
      } catch {
        // Ignore read errors on killed process
      }
    })();

    proc.exited.then((exitCode) => {
      clearTimeout(timeout);
      if (!killed) {
        resolve({ stdout, stderr, exitCode });
      }
    }).catch((err) => {
      clearTimeout(timeout);
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * Analyze audio loudness
 */
async function analyzeLoudness(inputPath: string): Promise<NormalizationAnalysis | null> {
  const log = createChildLogger({ inputPath });

  try {
    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', 'ebur128=peak=true',
      '-f', 'null',
      '-',
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode }, 'Loudness analysis failed');
      return null;
    }

    // Parse from Summary section
    const summaryMatch = stderr.match(/Summary:[\s\S]*$/);
    const summarySection = summaryMatch ? summaryMatch[0] : '';

    const integratedMatch = summarySection.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lraMatch = summarySection.match(/LRA:\s*(-?[\d.]+)\s*LU/);
    const truePeakMatch = summarySection.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);

    return {
      integratedLufs: integratedMatch ? parseFloat(integratedMatch[1]) : -23,
      loudnessRange: lraMatch ? parseFloat(lraMatch[1]) : 6,
      truePeak: truePeakMatch ? parseFloat(truePeakMatch[1]) : -1,
    };
  } catch (err) {
    log.error({ err }, 'Loudness analysis error');
    return null;
  }
}

/**
 * Build normalization filter chain
 */
export function buildNormalizationFilterChain(
  targetLufs: number,
  targetTruePeak: number
): string {
  const filters: string[] = [];

  // 25Hz highpass filter to remove subsonic rumble
  filters.push('highpass=f=25');

  // EBU R128 loudness normalization to target LUFS
  filters.push(`loudnorm=I=${targetLufs}:TP=${targetTruePeak}:LRA=11:print_format=summary`);

  return filters.join(',');
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
 * Run the normalization process for speech/podcast content
 */
export async function runNormalizationProcess(
  inputPath: string,
  outputPath: string,
  profile: AudioProfile,
  callbacks?: NormalizationCallbacks,
  outputFormat?: string
): Promise<NormalizationResult> {
  const log = createChildLogger({ inputPath, outputPath, profileType: profile.type });
  const startTime = Date.now();

  try {
    // Stage 1: Analysis
    callbacks?.onStage?.('Analyzing audio loudness...');
    callbacks?.onProgress?.(10);

    const inputAnalysis = await analyzeLoudness(inputPath);
    if (!inputAnalysis) {
      return { success: false, error: 'Failed to analyze input audio' };
    }

    log.info({ inputAnalysis }, 'Input analysis complete');

    // Stage 2: Build filter chain
    callbacks?.onStage?.('Building normalization chain...');
    callbacks?.onProgress?.(20);

    const filterChain = buildNormalizationFilterChain(profile.targetLufs, profile.targetTruePeak);

    log.info({
      filterChain,
      targetLufs: profile.targetLufs,
      targetTruePeak: profile.targetTruePeak,
    }, 'Filter chain built');

    // Stage 3: Process
    callbacks?.onStage?.('Normalizing audio...');
    callbacks?.onProgress?.(30);

    const format = outputFormat || outputPath.split('.').pop()?.toLowerCase() || 'wav';
    const codecArgs = getCodecArgs(format);

    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', filterChain,
      '-ar', '48000',
      ...codecArgs,
      '-y',
      outputPath,
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode, stderr }, 'Normalization process failed');
      return { success: false, error: `Normalization failed: ${stderr.slice(0, 500)}` };
    }

    callbacks?.onProgress?.(80);

    // Stage 4: Verify output
    callbacks?.onStage?.('Verifying output...');
    callbacks?.onProgress?.(90);

    const outputAnalysis = await analyzeLoudness(outputPath);

    // QC check
    if (outputAnalysis) {
      const targetRange = 1.0; // +/- 1 LUFS tolerance
      const lufsOk =
        outputAnalysis.integratedLufs >= profile.targetLufs - targetRange &&
        outputAnalysis.integratedLufs <= profile.targetLufs + targetRange;
      const tpOk = outputAnalysis.truePeak <= profile.targetTruePeak + 0.5;

      if (!lufsOk) {
        log.warn({
          outputLufs: outputAnalysis.integratedLufs,
          targetLufs: profile.targetLufs,
        }, 'Output LUFS outside target range');
      }
      if (!tpOk) {
        log.warn({
          outputTp: outputAnalysis.truePeak,
          targetTp: profile.targetTruePeak,
        }, 'Output true peak exceeds limit');
      }
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({ duration }, 'Normalization complete');

    return {
      success: true,
      outputPath,
      duration,
      inputAnalysis,
      outputAnalysis: outputAnalysis ?? undefined,
      filterChain,
      targetLufs: profile.targetLufs,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown normalization error';
    log.error({ err }, 'Normalization error');
    return { success: false, error: errorMessage };
  }
}

/**
 * Run peak normalization for SFX/samples (short files where LUFS doesn't apply)
 */
export async function runPeakNormalization(
  inputPath: string,
  outputPath: string,
  targetPeakDb: number = -1,
  callbacks?: NormalizationCallbacks,
  outputFormat?: string
): Promise<NormalizationResult> {
  const log = createChildLogger({ inputPath, outputPath });
  const startTime = Date.now();

  try {
    callbacks?.onStage?.('Analyzing audio...');
    callbacks?.onProgress?.(20);

    // Simple peak normalization filter
    const filterChain = `highpass=f=25,acompand=attacks=0:decays=0:points=-80/-80|-${Math.abs(targetPeakDb)}/${targetPeakDb}|0/${targetPeakDb}`;

    callbacks?.onStage?.('Peak normalizing...');
    callbacks?.onProgress?.(50);

    const format = outputFormat || outputPath.split('.').pop()?.toLowerCase() || 'wav';
    const codecArgs = getCodecArgs(format);

    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', `highpass=f=25,volume=0dB:eval=once:replaygain=track:replaygain_preamp=${targetPeakDb}dB`,
      '-ar', '48000',
      ...codecArgs,
      '-y',
      outputPath,
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode, stderr }, 'Peak normalization failed');
      return { success: false, error: `Peak normalization failed: ${stderr.slice(0, 500)}` };
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({ duration, filterChain }, 'Peak normalization complete');

    return {
      success: true,
      outputPath,
      duration,
      filterChain,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err }, 'Peak normalization error');
    return { success: false, error: errorMessage };
  }
}
