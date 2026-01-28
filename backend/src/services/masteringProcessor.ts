/**
 * Mastering Processor - Custom FFmpeg-based mastering pipeline
 * Based on auto_master_safe.sh
 * Target: -9 LUFS, -0.5 dBTP (safe headroom)
 */

import { spawn } from 'bun';
import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';

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

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value);
        }
      } catch (e) {
        if (!killed) logger.error({ err: e }, 'Error reading FFmpeg stdout');
      }
    })();

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value);
        }
      } catch (e) {
        if (!killed) logger.error({ err: e }, 'Error reading FFmpeg stderr');
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
 * Run FFprobe command and capture output
 */
async function runFFprobe(
  args: string[],
  timeoutMs: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn({
      cmd: ['ffprobe', ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill();
      reject(new Error('FFprobe timeout exceeded'));
    }, timeoutMs);

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value);
        }
      } catch (e) {
        if (!killed) logger.error({ err: e }, 'Error reading FFprobe stdout');
      }
    })();

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value);
        }
      } catch (e) {
        if (!killed) logger.error({ err: e }, 'Error reading FFprobe stderr');
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
 * Preflight check for input audio file
 */
export async function preflightCheck(inputPath: string): Promise<PreflightResult> {
  try {
    const { stdout, exitCode } = await runFFprobe([
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
    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', 'ebur128=peak=true,astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-'
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode }, 'Loudness analysis failed');
      return null;
    }

    // Parse EBU R128 metrics
    const integratedMatch = stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lraMatch = stderr.match(/LRA:\s*(-?[\d.]+)\s*LU/);
    const truePeakMatch = stderr.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);

    // Parse astats metrics (from first channel or overall)
    const rmsMatch = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);

    const integratedLufs = integratedMatch ? parseFloat(integratedMatch[1]) : -23;
    const lra = lraMatch ? parseFloat(lraMatch[1]) : 6;
    const truePeak = truePeakMatch ? parseFloat(truePeakMatch[1]) : -1;
    const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : -20;
    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : -1;
    const crestFactor = Math.abs(peakDb - rmsDb);

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
 * Build the mastering filter chain based on analysis
 */
export function buildMasteringFilterChain(analysis: MasteringAnalysis): {
  filterChain: string;
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
    filters.push('acompressor=threshold=-18dB:ratio=2.5:attack=30:release=200:makeup=0');
  }

  // Saturation decision: enable if LUFS < -12 AND true peak < -1.5
  if (analysis.integratedLufs < -12 && analysis.truePeak < -1.5) {
    saturationEnabled = true;
    filters.push('asoftclip=type=tanh');
  }

  // Loudness normalization to -9 LUFS with conservative true peak (-1.0 dBTP)
  // This leaves headroom for the limiter
  filters.push('loudnorm=I=-9:TP=-1.0:LRA=5:print_format=summary');

  // Aggressive true-peak limiter @ -0.6 dBTP (limit=0.93 ≈ -0.63 dB)
  // This ensures no inter-sample peaks exceed -0.5 dBTP
  filters.push('alimiter=limit=0.93:attack=0.5:release=20:level=false');

  return {
    filterChain: filters.join(','),
    compressionEnabled,
    saturationEnabled
  };
}

/**
 * Run the mastering process (outputs to intermediate WAV)
 */
export async function runMasteringProcess(
  inputPath: string,
  outputPath: string,
  callbacks?: MasteringCallbacks
): Promise<MasteringResult> {
  const log = createChildLogger({ inputPath, outputPath });
  const startTime = Date.now();

  try {
    // Stage 1: Analysis
    callbacks?.onStage?.('Analyzing audio dynamics...');
    callbacks?.onProgress?.(10);

    const inputAnalysis = await analyzeLoudnessForMastering(inputPath);
    if (!inputAnalysis) {
      return { success: false, error: 'Failed to analyze input audio' };
    }

    log.info({ inputAnalysis }, 'Input analysis complete');

    // Stage 2: Build filter chain
    callbacks?.onStage?.('Building mastering chain...');
    callbacks?.onProgress?.(20);

    const { filterChain, compressionEnabled, saturationEnabled } = buildMasteringFilterChain(inputAnalysis);

    log.info({
      filterChain,
      compressionEnabled,
      saturationEnabled
    }, 'Filter chain built');

    // Stage 3: Process
    callbacks?.onStage?.('Applying mastering chain...');
    callbacks?.onProgress?.(30);

    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', filterChain,
      '-ar', '48000',           // Output at 48kHz
      '-c:a', 'pcm_s24le',      // 24-bit WAV intermediate
      '-y',
      outputPath
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode, stderr }, 'Mastering process failed');
      return { success: false, error: `Mastering failed: ${stderr.slice(0, 500)}` };
    }

    callbacks?.onProgress?.(80);

    // Stage 4: Post-master QC
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

    log.info({ duration }, 'Mastering complete');

    return {
      success: true,
      outputPath,
      duration,
      inputAnalysis,
      outputAnalysis: outputAnalysis ?? undefined,
      filterChain,
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
