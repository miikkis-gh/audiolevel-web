import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import {
  buildNormalizeCommand,
  buildAnalyzeCommand,
  buildProbeCommand,
  parseLoudnessAnalysis,
  parseProbeOutput,
  parseNormalizeProgress,
  type NormalizeOptions,
  type LoudnessAnalysis,
  type AudioMetadata,
} from '../utils/ffmpeg';
import {
  getResourceLimitedCommand,
  getResourceLimitEnv,
  getAdaptiveResourceLimits,
  incrementActiveProcesses,
  decrementActiveProcesses,
  type ResourceLimits,
  DEFAULT_RESOURCE_LIMITS,
} from '../utils/resourceLimiter';
import { runMasteringProcess } from './masteringProcessor';
import { convertFormat } from './formatConverter';
import type { Preset } from '../schemas/upload';

export interface ProcessingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  inputAnalysis?: LoudnessAnalysis;
  outputAnalysis?: LoudnessAnalysis;
  metadata?: AudioMetadata;
}

export interface ProcessingCallbacks {
  onProgress?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

/**
 * Execute a command with timeout and resource limits
 */
async function executeWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (data: string) => void,
  useResourceLimits: boolean = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const log = createChildLogger({ command, args: args.slice(0, 3) });

  // Get adaptive resource limits based on system load
  const limits = useResourceLimits ? await getAdaptiveResourceLimits() : DEFAULT_RESOURCE_LIMITS;

  // Apply resource-limited wrapper (nice/ionice on Linux)
  const wrapped = useResourceLimits
    ? getResourceLimitedCommand(command, args, limits)
    : { command, args };

  // Get environment variables for resource limiting
  const resourceEnv = getResourceLimitEnv(limits);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    if (useResourceLimits) {
      incrementActiveProcesses();
    }

    const proc = spawn({
      cmd: [wrapped.command, ...wrapped.args],
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ...resourceEnv,
      },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill();
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          stdout += chunk;
          if (onOutput) onOutput(chunk);
        }
      } catch (e) {
        if (!killed) log.error({ err: e }, 'Error reading stdout');
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
          const chunk = decoder.decode(value);
          stderr += chunk;
          if (onOutput) onOutput(chunk);
        }
      } catch (e) {
        if (!killed) log.error({ err: e }, 'Error reading stderr');
      }
    })();

    // Wait for process to complete
    proc.exited.then((exitCode) => {
      clearTimeout(timeoutId);
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      if (!killed) {
        resolve({ stdout, stderr, exitCode });
      }
    }).catch((err) => {
      clearTimeout(timeoutId);
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * Get audio file metadata
 */
export async function getAudioMetadata(inputPath: string): Promise<AudioMetadata | null> {
  const log = createChildLogger({ inputPath });
  const { command, args } = buildProbeCommand(inputPath);

  try {
    const { stdout, exitCode } = await executeWithTimeout(
      command,
      args,
      30000 // 30 second timeout for probe
    );

    if (exitCode !== 0) {
      log.warn({ exitCode }, 'FFprobe returned non-zero exit code');
      return null;
    }

    return parseProbeOutput(stdout);
  } catch (err) {
    log.error({ err }, 'Failed to get audio metadata');
    return null;
  }
}

/**
 * Analyze audio loudness
 */
export async function analyzeLoudness(inputPath: string): Promise<LoudnessAnalysis | null> {
  const log = createChildLogger({ inputPath });
  const { command, args } = buildAnalyzeCommand(inputPath);

  try {
    const { stderr, exitCode } = await executeWithTimeout(
      command,
      args,
      env.PROCESSING_TIMEOUT_MS
    );

    if (exitCode !== 0) {
      log.warn({ exitCode }, 'FFmpeg analysis returned non-zero exit code');
      return null;
    }

    return parseLoudnessAnalysis(stderr);
  } catch (err) {
    log.error({ err }, 'Failed to analyze loudness');
    return null;
  }
}

/**
 * Normalize audio file
 */
export async function normalizeAudio(
  options: NormalizeOptions,
  callbacks?: ProcessingCallbacks
): Promise<ProcessingResult> {
  const log = createChildLogger({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    preset: options.preset,
  });

  const startTime = Date.now();

  try {
    // Get metadata first
    callbacks?.onStage?.('Analyzing input file...');
    const metadata = await getAudioMetadata(options.inputPath);
    if (!metadata) {
      return {
        success: false,
        error: 'Failed to read audio file metadata. The file may be corrupted or unsupported.',
      };
    }

    log.info({ metadata }, 'Audio metadata retrieved');

    // === MASTERING PRESET: Use custom FFmpeg pipeline ===
    if (options.preset === 'mastering') {
      return await processMasteringPreset(options, callbacks, log, startTime);
    }

    // === OTHER PRESETS: Use ffmpeg-normalize as before ===

    // Analyze input loudness
    callbacks?.onStage?.('Measuring loudness...');
    callbacks?.onProgress?.(10);
    const inputAnalysis = await analyzeLoudness(options.inputPath);
    if (inputAnalysis) {
      log.info({ inputAnalysis }, 'Input loudness analysis complete');
    }

    // Run normalization with resource limits
    callbacks?.onStage?.('Normalizing audio...');
    callbacks?.onProgress?.(20);

    const { command, args } = buildNormalizeCommand(options);
    log.info({ command, args }, 'Starting normalization with resource limits');

    let lastProgress = 20;
    const { stdout, stderr, exitCode } = await executeWithTimeout(
      command,
      args,
      env.PROCESSING_TIMEOUT_MS,
      (output) => {
        const progress = parseNormalizeProgress(output);
        if (progress > lastProgress) {
          // Map progress to 20-90 range
          const mappedProgress = 20 + Math.floor((progress / 100) * 70);
          lastProgress = mappedProgress;
          callbacks?.onProgress?.(mappedProgress);
        }
      },
      true // Enable resource limits for main processing
    );

    if (exitCode !== 0) {
      log.error({ exitCode, stderr }, 'Normalization failed');
      return {
        success: false,
        error: `Normalization failed: ${stderr.slice(0, 500)}`,
        duration: Date.now() - startTime,
      };
    }

    // Verify output file exists
    const outputFile = Bun.file(options.outputPath);
    const exists = await outputFile.exists();
    if (!exists) {
      return {
        success: false,
        error: 'Output file was not created',
        duration: Date.now() - startTime,
      };
    }

    // Analyze output loudness
    callbacks?.onStage?.('Verifying output...');
    callbacks?.onProgress?.(95);
    const outputAnalysis = await analyzeLoudness(options.outputPath);

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info(
      {
        duration,
        inputLufs: inputAnalysis?.inputLufs,
        outputLufs: outputAnalysis?.inputLufs,
      },
      'Normalization complete'
    );

    return {
      success: true,
      outputPath: options.outputPath,
      duration,
      processingType: 'ffmpeg-normalize' as const,
      inputAnalysis: inputAnalysis ?? undefined,
      outputAnalysis: outputAnalysis
        ? {
            inputLufs: outputAnalysis.inputLufs,
            inputTruePeak: outputAnalysis.inputTruePeak,
            inputLoudnessRange: outputAnalysis.inputLoudnessRange,
          }
        : undefined,
      metadata: metadata ?? undefined,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err }, 'Audio processing failed');

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Verify FFmpeg and ffmpeg-normalize are available
 */
export async function verifyDependencies(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegNormalize: boolean;
}> {
  const results = {
    ffmpeg: false,
    ffprobe: false,
    ffmpegNormalize: false,
  };

  try {
    const ffmpegCheck = await executeWithTimeout('ffmpeg', ['-version'], 5000);
    results.ffmpeg = ffmpegCheck.exitCode === 0;
  } catch {
    results.ffmpeg = false;
  }

  try {
    const ffprobeCheck = await executeWithTimeout('ffprobe', ['-version'], 5000);
    results.ffprobe = ffprobeCheck.exitCode === 0;
  } catch {
    results.ffprobe = false;
  }

  try {
    const normalizeCheck = await executeWithTimeout('ffmpeg-normalize', ['--version'], 5000);
    results.ffmpegNormalize = normalizeCheck.exitCode === 0;
  } catch {
    results.ffmpegNormalize = false;
  }

  logger.info({ dependencies: results }, 'Dependency check complete');
  return results;
}

/**
 * Process mastering preset with custom FFmpeg pipeline
 */
async function processMasteringPreset(
  options: NormalizeOptions,
  callbacks: ProcessingCallbacks | undefined,
  log: ReturnType<typeof createChildLogger>,
  startTime: number
): Promise<ProcessingResult> {
  // Determine output format from the output path
  const outputFormat = options.outputPath.split('.').pop()?.toLowerCase() || 'wav';

  // For mastering, we always process to WAV first, then convert
  const intermediateWav = options.outputPath.replace(/\.[^.]+$/, `-mastered-${randomUUID().slice(0, 8)}.wav`);

  try {
    // Run mastering process
    const masterResult = await runMasteringProcess(
      options.inputPath,
      outputFormat === 'wav' ? options.outputPath : intermediateWav,
      {
        onProgress: (percent) => {
          // Map mastering progress to 10-80%
          const mappedProgress = 10 + Math.floor((percent / 100) * 70);
          callbacks?.onProgress?.(mappedProgress);
        },
        onStage: callbacks?.onStage,
      }
    );

    if (!masterResult.success) {
      return {
        success: false,
        error: masterResult.error || 'Mastering failed',
        duration: Date.now() - startTime,
      };
    }

    // If output format is not WAV, convert
    if (outputFormat !== 'wav') {
      callbacks?.onStage?.('Converting to output format...');
      callbacks?.onProgress?.(85);

      const convertResult = await convertFormat({
        inputPath: intermediateWav,
        outputPath: options.outputPath,
        outputFormat,
      });

      // Clean up intermediate WAV
      try {
        await unlink(intermediateWav);
      } catch (e) {
        log.warn({ err: e }, 'Failed to clean up intermediate file');
      }

      if (!convertResult.success) {
        return {
          success: false,
          error: convertResult.error || 'Format conversion failed',
          duration: Date.now() - startTime,
        };
      }
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({
      duration,
      filterChain: masterResult.filterChain,
      decisions: masterResult.decisions,
      inputLufs: masterResult.inputAnalysis?.integratedLufs,
      outputLufs: masterResult.outputAnalysis?.integratedLufs,
    }, 'Mastering preset complete');

    return {
      success: true,
      outputPath: options.outputPath,
      duration,
      // Identify which processing pipeline was used
      processingType: 'mastering-pipeline' as const,
      // Include mastering decisions for verification
      masteringDecisions: masterResult.decisions,
      // Include filter chain for debugging
      filterChain: masterResult.filterChain,
      // Analysis data
      inputAnalysis: masterResult.inputAnalysis ? {
        inputLufs: masterResult.inputAnalysis.integratedLufs,
        inputTruePeak: masterResult.inputAnalysis.truePeak,
        inputLoudnessRange: masterResult.inputAnalysis.lra,
      } : undefined,
      outputAnalysis: masterResult.outputAnalysis ? {
        inputLufs: masterResult.outputAnalysis.integratedLufs,
        inputTruePeak: masterResult.outputAnalysis.truePeak,
        inputLoudnessRange: masterResult.outputAnalysis.lra,
      } : undefined,
    };
  } catch (err) {
    // Clean up intermediate file on error
    try {
      await unlink(intermediateWav);
    } catch (e) {
      // Ignore
    }
    throw err;
  }
}
